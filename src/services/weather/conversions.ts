export function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}

export function kmhToMph(value: number): number {
  return value * 0.621371;
}

export function pascalToInchesOfMercury(value: number): number {
  return value / 3386.389;
}

export function metersToStatuteMiles(value: number): number {
  return value / 1609.344;
}

export function metersToFeet(value: number): number {
  return value * 3.28084;
}

export function mmToInches(value: number): number {
  return value / 25.4;
}

export function mmPerHourToInchesPerHour(value: number): number {
  return value / 25.4;
}
