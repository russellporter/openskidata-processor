//! Overpass JSON front-end.
//!
//! `OSM_INPUT_DIR` files and test scenes arrive as `{"elements": [...]}`. Elements are
//! decoded one at a time from the array, so a planet-sized file never has to exist as a
//! single `Value` tree.

use crate::element::{Element, Feature, Member, MemberType, Node, Relation, Tags, Way};
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde::de::{DeserializeSeed, SeqAccess, Visitor};
use std::io::Read;

#[derive(Deserialize)]
struct RawMember {
    #[serde(rename = "type")]
    member_type: String,
    #[serde(rename = "ref")]
    reference: i64,
    role: Option<String>,
}

#[derive(Deserialize)]
struct RawElement {
    #[serde(rename = "type")]
    element_type: String,
    id: i64,
    lat: Option<f64>,
    lon: Option<f64>,
    nodes: Option<Vec<i64>>,
    members: Option<Vec<RawMember>>,
    tags: Option<Tags>,
}

impl RawElement {
    /// `None` for an element that is not a node, way or relation, or a node without a
    /// position -- both are skipped, as upstream skips them.
    fn into_element(self) -> Option<Element> {
        match self.element_type.as_str() {
            "node" => Some(Element::Node(Node {
                id: self.id,
                lat: self.lat?,
                lon: self.lon?,
                tags: self.tags,
            })),
            "way" => Some(Element::Way(Way {
                id: self.id,
                nodes: self.nodes,
                tags: self.tags,
            })),
            "relation" => Some(Element::Relation(Relation {
                id: self.id,
                members: self.members.map(|members| {
                    members
                        .into_iter()
                        .map(|member| Member {
                            member_type: match member.member_type.as_str() {
                                "node" => MemberType::Node,
                                "way" => MemberType::Way,
                                "relation" => MemberType::Relation,
                                _ => MemberType::Other,
                            },
                            reference: member.reference,
                            role: member.role,
                        })
                        .collect()
                }),
                tags: self.tags,
            })),
            _ => None,
        }
    }
}

struct ElementsVisitor<F: FnMut(Element)>(F);

impl<'de, F: FnMut(Element)> Visitor<'de> for ElementsVisitor<F> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("an array of OSM elements")
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut seq: A) -> Result<(), A::Error> {
        while let Some(raw) = seq.next_element::<RawElement>()? {
            if let Some(element) = raw.into_element() {
                (self.0)(element);
            }
        }
        Ok(())
    }
}

struct ElementsSeed<F: FnMut(Element)>(F);

impl<'de, F: FnMut(Element)> DeserializeSeed<'de> for ElementsSeed<F> {
    type Value = ();

    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_seq(ElementsVisitor(self.0))
    }
}

/// Streams the elements of an Overpass JSON document into `sink`.
///
/// Only the top-level `elements` array is read; other keys (`version`, `osm3s`, ...) are
/// skipped without being built into a tree.
pub fn read_elements<R: Read>(reader: R, sink: impl FnMut(Element)) -> Result<()> {
    struct DocVisitor<F: FnMut(Element)>(F);

    impl<'de, F: FnMut(Element)> Visitor<'de> for DocVisitor<F> {
        type Value = bool;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an Overpass JSON object")
        }

        fn visit_map<A: serde::de::MapAccess<'de>>(mut self, mut map: A) -> Result<bool, A::Error> {
            let mut seen = false;
            while let Some(key) = map.next_key::<String>()? {
                if key == "elements" {
                    map.next_value_seed(ElementsSeed(&mut self.0))?;
                    seen = true;
                } else {
                    map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
            Ok(seen)
        }
    }

    struct DocSeed<F: FnMut(Element)>(F);
    impl<'de, F: FnMut(Element)> DeserializeSeed<'de> for DocSeed<F> {
        type Value = bool;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<bool, D::Error> {
            d.deserialize_map(DocVisitor(self.0))
        }
    }

    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    let seen = DocSeed(sink)
        .deserialize(&mut deserializer)
        .context("invalid Overpass JSON")?;
    if !seen {
        bail!("Overpass JSON has no `elements` array");
    }
    Ok(())
}

/// The converted features of an Overpass JSON document, in emission order.
pub fn convert_overpass_json<R: Read>(reader: R) -> Result<Vec<Feature>> {
    let mut converter = crate::Converter::new();
    read_elements(reader, |element| converter.add(element))?;
    Ok(converter.features())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_converts_end_to_end() {
        let json = r#"{"version":0.6,"elements":[
            {"type":"node","id":1,"lat":1.0,"lon":2.0},
            {"type":"node","id":2,"lat":1.5,"lon":2.5},
            {"type":"way","id":10,"nodes":[1,2],"tags":{"aerialway":"chair_lift"}}
        ]}"#;
        let features = convert_overpass_json(json.as_bytes()).unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].osm_id(), "way/10");
    }

    #[test]
    fn a_node_without_a_position_is_skipped() {
        let json =
            r#"{"elements":[{"type":"node","id":1},{"type":"node","id":2,"lat":0,"lon":0}]}"#;
        let features = convert_overpass_json(json.as_bytes()).unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].id, 2);
    }

    #[test]
    fn a_document_without_elements_is_an_error() {
        assert!(convert_overpass_json(r#"{"version":0.6}"#.as_bytes()).is_err());
    }
}
