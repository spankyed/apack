import { describe, expect, it } from 'vitest';
import { parseMcpElicitationForm, validateMcpElicitationForm } from '#features/code/common/mcp-elicitation-form.ts';
const schema = { type: 'object', properties: {
 name: {type:'string',minLength:2,maxLength:12}, email: {type:'string',format:'email'}, uri: {type:'string',format:'uri'}, date: {type:'string',format:'date'}, time: {type:'string',format:'date-time'},
 count: {type:'integer',minimum:0,maximum:5}, ratio: {type:'number',minimum:0,maximum:1}, enabled: {type:'boolean',default:false},
 legacy: {type:'string',enum:['a','b'],enumNames:['Alpha','Beta'],default:'b'}, titled: {type:'string',oneOf:[{const:'x',title:'Ex'}]},
 tags: {type:'array',minItems:1,maxItems:2,items:{type:'string',enum:['a','b']}}, titledTags: {type:'array',items:{anyOf:[{const:'x',title:'Ex'}]}}, optional: {type:'string'},
 }, required:['name','count','enabled','tags'] };
describe('native MCP form interpretation and validation',()=>{
 it('supports every pinned primitive/enum variant, field order and false/zero/default values',()=>{
  const form=parseMcpElicitationForm(schema,['enabled','name','enabled','unknown']);expect(form.fields.slice(0,2).map(field=>field.name)).toEqual(['enabled','name']);
  expect(form.fields.find(field=>field.name==='legacy')).toMatchObject({options:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}],default:'b'});
  const content={name:'Fixture',email:'user@example.com',uri:'https://example.invalid',date:'2026-10-16',time:'2026-10-16T12:00:00+02:00',count:0,ratio:0.5,enabled:false,legacy:'a',titled:'x',tags:['b'],titledTags:['x']};
  expect(validateMcpElicitationForm(form,content)).toEqual({valid:true,errors:{},content});
 });
 it('does not coerce numbers or silently remove extra keys and returns field-specific constraints',()=>{
  const result=validateMcpElicitationForm(parseMcpElicitationForm(schema),{name:'x',count:'0',enabled:false,tags:['bad'],extra:1,email:'bad',uri:'not a uri',date:'2026-02-31',time:'not a date',ratio:2});
  expect(result.valid).toBe(false);expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(['name','count','tags','extra','email','uri','date','time','ratio']));expect(result.errors.enabled).toBeUndefined();
 });
 it('checks max-only and format-only constraints, required emptiness and array limits',()=>{
  const form=parseMcpElicitationForm({type:'object',properties:{short:{type:'string',maxLength:2},email:{type:'string',format:'email'},items:{type:'array',maxItems:1,items:{type:'string',enum:['a','b']}}},required:['short']});
  expect(validateMcpElicitationForm(form,{short:'long',email:'bad',items:['a','b']}).valid).toBe(false);
  expect(validateMcpElicitationForm(form,{short:''}).errors.short).toBe('Required');
 });
 it('omits blank optional fields without adding defaults to accepted content',()=>{
  const form=parseMcpElicitationForm({type:'object',properties:{optional:{type:'string',default:'review-me'},flag:{type:'boolean'}}});
  expect(validateMcpElicitationForm(form,{optional:'',flag:false})).toEqual({valid:true,errors:{},content:{flag:false}});
 });
 it.each([{type:'object',properties:{nested:{type:'object'}}},{type:'object',properties:{future:{type:'string',pattern:'x'}}},{type:'object',properties:{},required:['missing']}])('rejects unsupported constructs instead of silently dropping constraints',input=>expect(()=>parseMcpElicitationForm(input)).toThrow());
 it('rejects the prototype setter name without modifying any object prototype',()=>{
  expect(()=>parseMcpElicitationForm(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'))).toThrow('property name');
  const form=parseMcpElicitationForm({type:'object',properties:{constructor:{type:'string'}}});expect(validateMcpElicitationForm(form,{constructor:'fixture'})).toMatchObject({valid:true,content:{constructor:'fixture'}});
 });
});
