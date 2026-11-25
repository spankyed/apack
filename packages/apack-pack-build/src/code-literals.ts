/** JSON data emitted as JavaScript must define __proto__ as an own property. */
export function dataLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json.replace(/"__proto__":/g, '["__proto__"]:');
}

/** Keep ordinary generated notation while avoiding JavaScript's prototype-setter key. */
export function propertyKey(name: string, notation = JSON.stringify(name)): string {
  return name === '__proto__' ? `[${JSON.stringify(name)}]` : notation;
}
