import { SourceType } from "openskidata-format";
import Source from "openskidata-format/dist/Source";

export default function uniquedSources(sources: Source[]): Source[] {
  const map = new Map<SourceType, Set<string>>();
  return sources.reduce((uniquedSources: Source[], source) => {
    if (!map.has(source.type)) {
      map.set(source.type, new Set());
    }
    const sourceIDs = map.get(source.type)!;
    if (!sourceIDs.has(source.id)) {
      sourceIDs.add(source.id);
      uniquedSources.push(source);
    }

    return uniquedSources;
  }, []);
}
