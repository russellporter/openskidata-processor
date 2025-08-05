// Takes a latitude and longitude and returns a geocode object.

import { configFromEnvironment } from "../Config";
import Geocoder from "../transforms/Geocoder";

async function debugGeocode() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error(
      "Usage: GEOCODING_SERVER_URL=https://photon.komoot.io/reverse npm run debug-geocode <latitude> <longitude>",
    );
    console.error("Required environment variables:");
    console.error("  GEOCODING_SERVER_URL - URL of the geocoding server");
    console.error("Optional environment variables:");
    console.error("  GEOCODING_SERVER_URL_TTL - Cache TTL in milliseconds");
    process.exit(1);
  }

  const latitude = parseFloat(args[0]);
  const longitude = parseFloat(args[1]);

  if (isNaN(latitude) || isNaN(longitude)) {
    console.error("Invalid coordinates. Please provide valid numbers.");
    process.exit(1);
  }

  const config = configFromEnvironment();

  if (!config.geocodingServer) {
    console.error(
      "Geocoding server configuration is missing. Please set GEOCODING_SERVER_URL environment variable.",
    );
    process.exit(1);
  }

  const geocoder = new Geocoder(config.geocodingServer, config.postgresCache);

  try {
    await geocoder.initialize();

    const result = await geocoder.rawGeocode([longitude, latitude]);
    let readableResult: any = result;
    readableResult.date = new Date(result.timestamp).toISOString();

    console.log("Geocoding result:");
    console.log(JSON.stringify(readableResult, null, 2));
  } catch (error) {
    console.error("Geocoding failed:", error);
    process.exit(1);
  } finally {
    await geocoder.close();
  }
}

debugGeocode();
