// The part of DEVICE_FEATURE_UNITS_BY_CATEGORY (server/utils/constants.js of
// the Gladys core) this integration uses, copied from the core.
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

export const DEVICE_FEATURE_UNITS_BY_CATEGORY = {
  [C.ENERGY_SENSOR]: [
    U.MILLI_AMPERE,
    U.AMPERE,
    U.MILLI_VOLT,
    U.VOLT,
    U.WATT,
    U.KILOWATT,
    U.WATT_HOUR,
    U.KILOWATT_HOUR,
    U.MEGAWATT_HOUR,
    U.KILOVOLT_AMPERE,
    U.VOLT_AMPERE,
    U.VOLT_AMPERE_REACTIVE,
    U.EURO,
    U.DOLLAR,
  ],
  [C.ELECTRICAL_VEHICLE_CHARGE]: [
    U.AMPERE,
    U.KILOWATT,
    U.KILOWATT_HOUR,
    U.MEGAWATT_HOUR,
    U.PERCENT,
    U.VOLT,
  ],
  [C.CURRENCY]: [U.EURO, U.DOLLAR, U.BITCOIN, U.LITECOIN, U.ETHEREUM, U.DOGECOIN, U.POUND_STERLING],
  [C.DURATION]: [
    U.MICROSECONDS,
    U.MILLISECONDS,
    U.SECONDS,
    U.MINUTES,
    U.HOURS,
    U.DAYS,
    U.WEEKS,
    U.MONTHS,
    U.YEARS,
  ],
};
