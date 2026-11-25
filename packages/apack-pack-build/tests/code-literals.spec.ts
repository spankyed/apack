import { expect, it } from 'vitest';
import { dataLiteral, propertyKey } from '../src/code-literals.ts';

it('emits safe own properties recursively without changing JSON string contents', () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"nested":[{"__proto__":"owned"}],"text":"\\\"__proto__\\\": value"}');
  const value = Function(`return (${dataLiteral(source)})`)();
  expect(value).toEqual(source);
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect(Object.hasOwn(value.nested[0], '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(value.text).toBe(source.text);
});

it('keeps ordinary notation and computed keys beside executable bindings', () => {
  expect(propertyKey('note', 'note')).toBe('note');
  const value = Function('binding', `return ({ ${propertyKey('__proto__')}: binding })`)(17);
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect(value['__proto__']).toBe(17);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
});
