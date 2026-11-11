import { headers } from 'next/headers';
import { getMe } from './api';

/** The signed-in user of this request, or null (getMe is cached per request). */
export const currentUser = async () => getMe((await headers()).get('cookie') ?? '');
