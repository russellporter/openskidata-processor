//! Index of `site=piste` relations by member.
//!
//! Replaces: `src/transforms/SkiAreaSiteProvider.ts`.
//!
//! A `site=piste` relation lists the runs, lifts and spots belonging to one ski area. Each
//! of those objects needs to know which sites it is a member of, so the relations are
//! indexed by member once and looked up per object.
//!
//! # Duplicates are preserved
//!
//! Upstream never de-duplicates, and the live implementation confirms it: a relation that
//! lists the same member twice appears twice in that member's sites, and an object with two
//! OSM sources that share a site gets that site twice. This reproduces that on purpose. It
//! is the stage's observable behaviour, and any de-duplication belongs to a later stage
//! that already handles it, rather than being introduced here and quietly changing what
//! reaches it.

use crate::ski_area::{SkiAreaTagProperties, site};
use crate::status::Tags;
use openskidata_format::SourceType;
use openskidata_format::source::Source;
use std::collections::HashMap;

/// A relation member, as OSM lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteMember {
    /// `node`, `way` or `relation`. Part of the key: `way/10` and `node/10` are different
    /// objects.
    pub osm_type: String,
    pub reference: i64,
}

/// A `site=piste` relation that was accepted as a ski area.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Site {
    pub osm_type: String,
    pub relation_id: i64,
    pub properties: SkiAreaTagProperties,
}

/// Accepted sites, indexed by the objects that belong to them.
#[derive(Debug, Default)]
pub struct SiteProvider {
    sites: Vec<Site>,
    /// `type/ref` to positions in `sites`, in the order members were listed.
    by_member: HashMap<String, Vec<usize>>,
}

impl SiteProvider {
    /// Adds a relation. Returns whether it was accepted.
    ///
    /// A relation in an unsupported lifecycle state is rejected and contributes nothing,
    /// not even its members. A relation with no members at all is still a site: it is kept
    /// in [`SiteProvider::all`] even though nothing can look it up.
    pub fn add(
        &mut self,
        osm_type: &str,
        relation_id: i64,
        tags: &Tags,
        members: &[SiteMember],
    ) -> bool {
        let Some(properties) = site(osm_type, relation_id, tags) else {
            return false;
        };

        let position = self.sites.len();
        self.sites.push(Site {
            osm_type: osm_type.to_owned(),
            relation_id,
            properties,
        });

        for member in members {
            let key = format!("{}/{}", member.osm_type, member.reference);
            self.by_member.entry(key).or_default().push(position);
        }
        true
    }

    /// Every accepted site, in the order added.
    pub fn all(&self) -> &[Site] {
        &self.sites
    }

    /// The sites an OSM object belongs to, e.g. `way/10`.
    pub fn sites_for(&self, osm_id: &str) -> Vec<&Site> {
        self.by_member
            .get(osm_id)
            .map(|positions| positions.iter().map(|&p| &self.sites[p]).collect())
            .unwrap_or_default()
    }

    /// The sites for an object, given its sources.
    ///
    /// Replaces `addSkiAreaSites`. Only OpenStreetMap sources count; a Skimap.org source
    /// with a coincidentally similar id is ignored. Results are concatenated in source
    /// order, with no de-duplication.
    pub fn sites_for_sources(&self, sources: &[Source]) -> Vec<&Site> {
        sources
            .iter()
            .filter(|source| source.source_type == SourceType::Openstreetmap)
            .flat_map(|source| self.sites_for(&source.id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    fn member(osm_type: &str, reference: i64) -> SiteMember {
        SiteMember {
            osm_type: osm_type.to_owned(),
            reference,
        }
    }

    fn osm(id: &str) -> Source {
        Source {
            source_type: SourceType::Openstreetmap,
            id: id.to_owned(),
        }
    }

    fn names(sites: &[&Site]) -> Vec<String> {
        sites
            .iter()
            .map(|s| {
                format!(
                    "{}#{}",
                    s.properties.name.as_deref().unwrap_or("null"),
                    s.properties.sources[0].id
                )
            })
            .collect()
    }

    /// Mirrors the probe run against the live TypeScript, case for case.
    fn probe() -> SiteProvider {
        let mut provider = SiteProvider::default();
        let piste = |name: &str| tags(&[("site", "piste"), ("name", name)]);
        provider.add(
            "relation",
            1,
            &piste("A"),
            &[member("way", 10), member("way", 10), member("way", 11)],
        );
        provider.add(
            "relation",
            2,
            &piste("B"),
            &[member("way", 10), member("node", 10)],
        );
        provider.add(
            "relation",
            3,
            &tags(&[("site", "demolished")]),
            &[member("way", 99)],
        );
        provider.add("relation", 4, &tags(&[("site", "piste")]), &[]);
        provider
    }

    #[test]
    fn rejected_sites_contribute_nothing() {
        let provider = probe();
        assert_eq!(
            names(&provider.all().iter().collect::<Vec<_>>()),
            vec!["A#relation/1", "B#relation/2", "null#relation/4"],
            "the demolished site is gone; the memberless one is kept"
        );
        assert!(provider.sites_for("way/99").is_empty());
    }

    /// A member listed twice yields its site twice -- upstream never de-duplicates.
    #[test]
    fn a_member_listed_twice_yields_its_site_twice() {
        assert_eq!(
            names(&probe().sites_for("way/10")),
            vec!["A#relation/1", "A#relation/1", "B#relation/2"]
        );
    }

    #[test]
    fn the_member_type_is_part_of_the_key() {
        assert_eq!(names(&probe().sites_for("node/10")), vec!["B#relation/2"]);
        assert!(probe().sites_for("relation/10").is_empty());
    }

    #[test]
    fn unknown_objects_have_no_sites() {
        assert!(probe().sites_for("way/404").is_empty());
    }

    /// Two sources that share a site give that site twice, in source order.
    #[test]
    fn sources_are_concatenated_without_deduplication() {
        let provider = probe();
        let sources = [osm("way/10"), osm("way/11")];
        assert_eq!(
            names(&provider.sites_for_sources(&sources)),
            vec![
                "A#relation/1",
                "A#relation/1",
                "B#relation/2",
                "A#relation/1"
            ]
        );
    }

    #[test]
    fn only_openstreetmap_sources_count() {
        let skimap = Source {
            source_type: SourceType::SkimapOrg,
            id: "way/10".to_owned(),
        };
        assert!(probe().sites_for_sources(&[skimap]).is_empty());
    }
}
