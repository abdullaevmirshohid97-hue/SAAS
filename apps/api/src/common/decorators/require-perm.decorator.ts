import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '../rbac/permissions';

export const REQUIRE_PERM_KEY = 'require_perm';

export const RequirePerm = (...keys: PermissionKey[]) => SetMetadata(REQUIRE_PERM_KEY, keys);
