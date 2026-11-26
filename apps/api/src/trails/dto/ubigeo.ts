import { UBIGEOS } from '@ciudad-enduro/geo';
import { IsIn } from 'class-validator';

// A string with a pattern, never an enum: the list has 1,892 codes (plan §10.1 A3).
export const UBIGEO_PATTERN = '^[0-9]{6}$';
export const UBIGEO_PROPERTY = { type: String, pattern: UBIGEO_PATTERN, description: 'INEI district code', example: '021801' };
export const isUbigeo = IsIn(UBIGEOS as string[], { message: '$property must be a district code of Peru' });
