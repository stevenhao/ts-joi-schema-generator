import * as Joi from '@hapi/joi';

export const fooSchema = Joi.object().keys({
  x: Joi.string().required(),
}).strict();