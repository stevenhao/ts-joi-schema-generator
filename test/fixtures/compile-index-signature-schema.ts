import * as Joi from '@hapi/joi';

export const ITestSchema = Joi.object().keys({
}).pattern(/^.*$/, Joi.any().required()).required().strict();

export const ITest2Schema = Joi.object().keys({
}).pattern(/^blue.*$/, Joi.any().required()).required().strict();

export const ITest3Schema = Joi.object().keys({
}).pattern(/^blue.*$/, Joi.string().regex(/^green.*$/).required()).required().strict();