import { starterWorkspace } from '../../src/fixture.mjs';
import { json } from './_common.mjs';

export const handler = async () => json(200, { files: starterWorkspace });
