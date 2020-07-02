import * as Joi from '@hapi/joi';

export const SomeEnumSchema = (() => {
  const members = {
    Foo: Joi.valid(0),
    Bar: Joi.valid(1),
  };
  return {
    ...Joi.valid(0, 1),
    members,
  };
})();

export const DirectionSchema = (() => {
  const members = {
    Up: Joi.valid(1),
    Down: Joi.valid(2),
    Left: Joi.valid(17),
    Right: Joi.valid(18),
  };
  return {
    ...Joi.valid(1, 2, 17, 18),
    members,
  };
})();

export const DirectionStrSchema = (() => {
  const members = {
    Up: Joi.valid("UP"),
    Down: Joi.valid("DOWN"),
    Left: Joi.valid("LEFT"),
    Right: Joi.valid("RIGHT"),
  };
  return {
    ...Joi.valid("UP", "DOWN", "LEFT", "RIGHT"),
    members,
  };
})();

export const BooleanLikeHeterogeneousEnumSchema = (() => {
  const members = {
    No: Joi.valid(0),
    Yes: Joi.valid("YES"),
  };
  return {
    ...Joi.valid(0, "YES"),
    members,
  };
})();

export const EnumComputedSchema = (() => {
  const members = {
    Foo: Joi.valid(0),
    Bar: Joi.valid(17),
    Baz: Joi.valid(16),
  };
  return {
    ...Joi.valid(0, 17, 16),
    members,
  };
})();

export const AnimalFlagsSchema = (() => {
  const members = {
    None: Joi.valid(0),
    HasClaws: Joi.valid(1),
    CanFly: Joi.valid(2),
    EatsFish: Joi.valid(4),
    Endangered: Joi.valid(8),
  };
  return {
    ...Joi.valid(0, 1, 2, 4, 8),
    members,
  };
})();

export const ICacheItemSchema = Joi.object().keys({
  key: Joi.alternatives(
    Joi.string().regex(/^key-\d+$/),
    Joi.valid(null)
  ).required(),
  value: Joi.any().required(),
  size: Joi.number().required(),
  tag: Joi.string(),
}).strict();

export const ILRUCacheSchema = Joi.object().keys({
  capacity: Joi.number().integer().required(),
  set: Joi.func().required(),
  get: Joi.func().required(),
}).strict();

export const ISamplingSchema = Joi.object().concat(ICacheItemSchema).keys({
  xstring: Joi.string().required(),
  xstring2: Joi.string().required(),
  xany: Joi.any().required(),
  xnumber: Joi.number().required(),
  xnumber2: Joi.number(),
  xnumber3: Joi.number().integer().min(0).max(2).required(),
  xnumber4: Joi.number().max(10).required(),
  xNumberAlias: Joi.lazy(() => NumberAliasSchema).required(),
  xNumberAlias2: Joi.lazy(() => NumberAlias2Schema).required(),
  xnull: Joi.valid(null).required(),
  xMyType: Joi.lazy(() => MyTypeSchema).required(),
  xarray: Joi.array().items(Joi.string()).required(),
  xarray2: Joi.array().items(Joi.lazy(() => MyTypeSchema)).required(),
  xtuple: Joi.array().ordered(
    Joi.string(),
    Joi.number()
  ).required(),
  xunion: Joi.alternatives(
    Joi.number(),
    Joi.valid(null)
  ).required(),
  xparen: Joi.alternatives(
    Joi.number(),
    Joi.string()
  ).required(),
  xiface: Joi.object().keys({
    foo: Joi.string().required(),
    bar: Joi.number().required(),
  }).required(),
  xliteral: Joi.alternatives(
    Joi.valid('foo'),
    Joi.valid('ba\'r'),
    Joi.valid(3)
  ).required(),
  xfunc: Joi.func().required(),
  xfunc2: Joi.func().required(),
  xDirection: Joi.lazy(() => DirectionSchema).required(),
  xDirectionStr: Joi.lazy(() => DirectionStrSchema).required(),
  xDirUp: Joi.alternatives(
    Joi.lazy(() => DirectionSchema.members.Up),
    Joi.lazy(() => DirectionSchema.members.Left)
  ).required(),
  xDirStrLeft: Joi.lazy(() => DirectionStrSchema.members.Left).required(),
  ximplicit: Joi.any().required(),
  ximplicitFunc: Joi.func().required(),
  ximplicitFunc2: Joi.func().required(),
}).strict();

export const MyTypeSchema = Joi.alternatives(
  Joi.boolean(),
  Joi.number(),
  Joi.lazy(() => ILRUCacheSchema)
).strict();

export const NumberAliasSchema = Joi.number().strict();

export const NumberAlias2Schema = Joi.lazy(() => NumberAliasSchema).strict();