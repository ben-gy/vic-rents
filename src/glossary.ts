// SPDX-License-Identifier: AGPL-3.0-or-later
// Domain glossary. Terms are surfaced as clickable ℹ popovers via data-term.
export const GLOSSARY: Record<string, string> = {
  'median rent': 'The middle rent in a set of new lettings — half were dearer, half cheaper. It is not the average, and it is less distorted by a handful of very expensive or very cheap properties.',
  'moving annual median': 'For suburbs, DFFH reports a median over the most recent 12 months of new lettings (a "moving annual" window), so small suburbs still have enough lettings to report a stable figure. LGA medians use a moving quarterly window.',
  'new lettings': 'A property newly rented out (a fresh lease bond lodged with the Residential Tenancies Bond Authority) during the period. Sitting tenants who simply renew are not counted, so this measures the rent being asked of people moving in now.',
  'lettings count': 'How many new leases were signed in the period. It is a gauge of rental activity and supply; a low count means the median rests on few transactions and should be read with caution.',
  'bond': 'A rental security deposit, lodged with the Residential Tenancies Bond Authority (RTBA). Every new tenancy lodges one, which is how the government counts lettings and their rents.',
  'RTBA': 'The Residential Tenancies Bond Authority — the Victorian body that holds rental bonds. Its bond lodgements are the raw source for the Rental Report.',
  'real rent': 'Rent adjusted for inflation, expressed in today\'s dollars using the ABS Consumer Price Index. It shows whether rents rose faster than the cost of living generally — a "real" rise means renters are worse off even after wages and prices moved.',
  'nominal rent': 'The rent in the dollars of the day, with no inflation adjustment — the number actually on the lease at the time.',
  CPI: 'Consumer Price Index — the ABS measure of how much a typical basket of goods and services costs over time. Used here (Melbourne, all groups) to convert past rents into today\'s dollars.',
  LGA: 'Local Government Area — a council. Victoria has 79 of them, from the City of Melbourne to the Rural City of Mildura. The map is drawn at this level.',
  suburb: 'DFFH reports rents for suburbs and towns, some grouped together (e.g. "Albert Park-Middle Park-West St Kilda") where a single suburb has too few lettings to report on its own. These groupings are the report\'s own, not ABS suburb boundaries — which is why the map is drawn at council (LGA) level.',
  metro: 'Metropolitan Melbourne — the councils of greater Melbourne. "Non-metro" (regional) is the rest of Victoria.',
  'property type': 'The Rental Report splits rents by dwelling: 1, 2 and 3-bedroom flats/units, and 2, 3 and 4-bedroom houses, plus an "all properties" figure.',
};
export const GLOSSARY_KEYS = Object.keys(GLOSSARY);

/** Wrap the first occurrence of a known term in text with a clickable ℹ marker. */
export function withGlossary(text: string, term: string): string {
  if (!GLOSSARY[term]) return text;
  return `${text}<span class="gloss" data-term="${term}" role="button" tabindex="0" aria-label="Definition of ${term}">ℹ</span>`;
}
