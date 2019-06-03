export function addLocalIDFactory<X extends GeoJSON.Feature>(): (
  input: X
) => X {
  let i = 0;
  return (input: X) => {
    i++;
    input.properties = input.properties || {};
    input.properties.id = "" + i;
    return input;
  };
}
