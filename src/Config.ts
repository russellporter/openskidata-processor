export interface Config {
  arangoDBURLForClustering: string | null;
  elevationServerURL: string | null;
}

export function configFromEnvironment(): Config {
  return {
    arangoDBURLForClustering: process.env["CLUSTERING_ARANGODB_URL"] || null,
    elevationServerURL: process.env["ELEVATION_SERVER_URL"] || null
  };
}
