import * as Joi from '@hapi/joi';

import { ITypeCSchema } from './imports-child-c-schema';
export { ITypeCSchema };
export { ITypeDSchema } from './imports-child-d-schema';

export const ITypeBSchema = Joi.object().required().strict();