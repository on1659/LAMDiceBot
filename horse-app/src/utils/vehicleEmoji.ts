import type { VehicleId } from '../types/vehicle';

export const VEHICLE_EMOJI: Record<VehicleId, string> = {
  car: '🚗',
  rocket: '🚀',
  bird: '🐦',
  boat: '⛵',
  bicycle: '🚲',
  rabbit: '🐰',
  turtle: '🐢',
  eagle: '🦅',
  scooter: '🛴',
  helicopter: '🚁',
  horse: '🐴',
};

export const VEHICLE_BACKGROUNDS: Record<VehicleId, string> = {
  car: 'linear-gradient(90deg, #2d3436 0%, #636e72 100%)',
  rocket: 'linear-gradient(90deg, #0c2461 0%, #1e3799 100%)',
  bird: 'linear-gradient(90deg, #0a3d62 0%, #3c6382 100%)',
  boat: 'linear-gradient(90deg, #006266 0%, #009432 100%)',
  bicycle: 'linear-gradient(90deg, #b33939 0%, #cd6133 100%)',
  rabbit: 'linear-gradient(90deg, #6F1E51 0%, #B33771 100%)',
  turtle: 'linear-gradient(90deg, #1B1464 0%, #0652DD 100%)',
  eagle: 'linear-gradient(90deg, #833471 0%, #ED4C67 100%)',
  scooter: 'linear-gradient(90deg, #2C3A47 0%, #556B2F 100%)',
  helicopter: 'linear-gradient(90deg, #4a69bd 0%, #6a89cc 100%)',
  horse: 'linear-gradient(90deg, #5f3dc4 0%, #845ef7 100%)',
};

export function getVehicleEmoji(vehicleId: string): string {
  return VEHICLE_EMOJI[vehicleId as VehicleId] || '❓';
}
