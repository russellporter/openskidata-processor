import { Status } from "openskidata-format";

// Conversion from various OpenStreetMap life cycle concepts to openskidata-format "Status"
// Add a "status" property which can be one of "abandoned", "disused", "operating", "proposed", "planned", "construction"
// Supports several common tagging schemes:
// - proposed/planned/construction/abandoned/disused:{key} = {value}
// - proposed/planned/construction/abandoned/disused = yes
// - {key} = construction & construction = {value}
export default function getStatusAndValue(
  key: string,
  properties: { [key: string]: string }
): { status: Status; value: string | null } {
  if (properties.hasOwnProperty(key)) {
    const valueOrStatus = properties[key];
    if (lifecycleStates.has(valueOrStatus as any)) {
      return {
        status: valueOrStatus as any,
        value: properties[valueOrStatus] || null
      };
    }
  } else {
    for (const state of lifecycleStates) {
      const lifecycleKey = getLifecycleKey(key, state);
      if (properties.hasOwnProperty(lifecycleKey)) {
        return {
          status: state,
          value: properties[lifecycleKey] || null
        };
      }
    }
  }

  let status = Status.Operating;
  for (const state of lifecycleStates) {
    if (properties.hasOwnProperty(state) && properties[state] === "yes") {
      status = state;
      break;
    }
  }

  return {
    status: status,
    value: properties[key] || null
  };
}

const lifecycleStates = new Set([
  Status.Disused,
  Status.Abandoned,
  Status.Proposed,
  Status.Planned,
  Status.Construction
]);

function lifecyclePrefixForStatus(status: Status) {
  switch (status) {
    case Status.Disused:
      return "disused:";
    case Status.Abandoned:
      return "abandoned:";
    case Status.Operating:
      return "";
    case Status.Proposed:
      return "proposed:";
    case Status.Planned:
      return "planned:";
    case Status.Construction:
      return "construction:";
  }
}

function getLifecycleKey(originalKey: string, status: Status): string {
  return lifecyclePrefixForStatus(status) + originalKey;
}
