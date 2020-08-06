import * as Joi from '@hapi/joi';

export const SomeEnumSchema = (() => {
  const members = {
    Foo: Joi.valid(0).required(),
    Bar: Joi.valid(1).required(),
  };
  return {
    ...Joi.valid(0, 1).required(),
    members,
  };
})();

export const DirectionSchema = (() => {
  const members = {
    Up: Joi.valid(1).required(),
    Down: Joi.valid(2).required(),
    Left: Joi.valid(17).required(),
    Right: Joi.valid(18).required(),
  };
  return {
    ...Joi.valid(1, 2, 17, 18).required(),
    members,
  };
})();

export const DirectionStrSchema = (() => {
  const members = {
    Up: Joi.valid("UP").required(),
    Down: Joi.valid("DOWN").required(),
    Left: Joi.valid("LEFT").required(),
    Right: Joi.valid("RIGHT").required(),
  };
  return {
    ...Joi.valid("UP", "DOWN", "LEFT", "RIGHT").required(),
    members,
  };
})();

export const BooleanLikeHeterogeneousEnumSchema = (() => {
  const members = {
    No: Joi.valid(0).required(),
    Yes: Joi.valid("YES").required(),
  };
  return {
    ...Joi.valid(0, "YES").required(),
    members,
  };
})();

export const EnumComputedSchema = (() => {
  const members = {
    Foo: Joi.valid(0).required(),
    Bar: Joi.valid(17).required(),
    Baz: Joi.valid(16).required(),
  };
  return {
    ...Joi.valid(0, 17, 16).required(),
    members,
  };
})();

export const AnimalFlagsSchema = (() => {
  const members = {
    None: Joi.valid(0).required(),
    HasClaws: Joi.valid(1).required(),
    CanFly: Joi.valid(2).required(),
    EatsFish: Joi.valid(4).required(),
    Endangered: Joi.valid(8).required(),
  };
  return {
    ...Joi.valid(0, 1, 2, 4, 8).required(),
    members,
  };
})();

export const ICacheItemSchema = Joi.object().keys({
  key: Joi.alternatives(
    Joi.string().regex(/^key-\d+$/).required(),
    Joi.valid(null).required(),
  ).required(),
  value: Joi.any().required(),
  size: Joi.number().required(),
  tag: Joi.string(),
}).required().strict();

export const ILRUCacheSchema = Joi.object().keys({
  capacity: Joi.number().integer().required(),
  set: Joi.func().required(),
  get: Joi.func().required(),
}).required().strict();

export const ISamplingSchema = Joi.object().concat(ICacheItemSchema).keys({
  xboolean: Joi.boolean().required(),
  xstring: Joi.string().required(),
  xstring2: Joi.string().required(),
  xany: Joi.any().required(),
  xnumber: Joi.number().required(),
  xnumber2: Joi.number(),
  xnumber3: Joi.number().integer().min(0).max(2).required(),
  xnumber4: Joi.number().max(10).required(),
  xNumberAlias: Joi.number().required(),
  xNumberAlias2: Joi.number().required(),
  xnull: Joi.valid(null).required(),
  xMyType: Joi.lazy(() => MyTypeSchema).required(),
  xarray: Joi.array().items(Joi.string()).required(),
  xarray2: Joi.array().items(Joi.lazy(() => MyTypeSchema)).required(),
  xarray3: Joi.array().items(Joi.number()).sparse().required(),
  xarray4: Joi.array().items(Joi.string()).min(2).max(4).required(),
  xtuple: Joi.array().ordered(
    Joi.string().required(),
    Joi.number().required(),
  ).required(),
  xtuple2: Joi.array().ordered(
    Joi.string().required(),
    Joi.number(),
  ).items(Joi.valid(1)).required(),
  xunion: Joi.alternatives(
    Joi.number().required(),
    Joi.valid(null).required(),
  ).required(),
  xunion2: Joi.alternatives(
    Joi.number().required(),
    Joi.boolean().required(),
  ).required(),
  xparen: Joi.alternatives(
    Joi.string().required(),
    Joi.number().required(),
  ).required(),
  xiface: Joi.object().keys({
    foo: Joi.string().required(),
    bar: Joi.number().required(),
  }).required(),
  xiface2: Joi.object().keys({
    foo: Joi.lazy(() => MyTypeSchema).required(),
    bar: Joi.number().required(),
  }).required(),
  xliteral: Joi.alternatives(
    Joi.valid("foo").required(),
    Joi.valid("ba'r").required(),
    Joi.valid(3).required(),
  ).required(),
  xfunc: Joi.func().required(),
  xfunc2: Joi.func().required(),
  xDirection: Joi.lazy(() => DirectionSchema).required(),
  xDirectionStr: Joi.lazy(() => DirectionStrSchema).required(),
  xDirUp: Joi.alternatives(
    Joi.lazy(() => DirectionSchema.members.Up).required(),
    Joi.lazy(() => DirectionSchema.members.Left).required(),
    Joi.lazy(() => DirectionSchema.members.Right).required(),
  ).required(),
  xDirStrLeft: Joi.lazy(() => DirectionStrSchema.members.Left).required(),
  xnever: Joi.forbidden(),
  xundefined: Joi.valid([]).optional(),
  ximplicit: Joi.any().required(),
  ximplicitFunc: Joi.func().required(),
  ximplicitFunc2: Joi.func().required(),
}).required().strict();

export const MyTypeSchema = Joi.alternatives(
  Joi.number().required(),
  Joi.boolean().required(),
  Joi.lazy(() => ILRUCacheSchema).required(),
).required().strict();

export const NumberAliasSchema = Joi.number().required().strict();

export const NumberAlias2Schema = Joi.number().required().strict();