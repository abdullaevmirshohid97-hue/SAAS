import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_CLINIC_KEY = 'allowWithoutClinic';
export const AllowWithoutClinic = () => SetMetadata(ALLOW_WITHOUT_CLINIC_KEY, true);
