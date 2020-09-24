import * as Joi from '@hapi/joi';

export const LateInterfaceSchema = Joi.object().keys({
  field: Joi.lazy(() => LaterInterfaceSchema).required(),
}).required().strict();

export const LaterInterfaceSchema = Joi.object().keys({
  field: Joi.valid(1).required(),
}).required().strict();

export const EarlyRefSchema = Joi.lazy(() => LateInterfaceSchema).required().strict();