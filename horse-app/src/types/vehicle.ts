export type VehicleId =
  | 'car' | 'rocket' | 'bird' | 'boat' | 'bicycle'
  | 'rabbit' | 'turtle' | 'eagle' | 'scooter'
  | 'helicopter' | 'horse';

export const ALL_VEHICLE_IDS: VehicleId[] = [
  'car', 'rocket', 'bird', 'boat', 'bicycle',
  'rabbit', 'turtle', 'eagle', 'scooter',
  'helicopter', 'horse',
];

export interface VehicleTheme {
  id: VehicleId;
  name: string;
  emoji: string;
  theme: string;
  backgroundImage: string;
  visualWidth: number;
}

export type VehicleThemeMap = Record<VehicleId, VehicleTheme>;

export const VEHICLE_NAMES: Record<VehicleId, string> = {
  car: '자동차',
  rocket: '로켓',
  bird: '새',
  boat: '보트',
  bicycle: '자전거',
  rabbit: '토끼',
  turtle: '거북이',
  eagle: '독수리',
  scooter: '킥보드',
  helicopter: '헬리콥터',
  horse: '말',
};
