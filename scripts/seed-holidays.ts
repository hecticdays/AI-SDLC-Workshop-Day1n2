import Holidays from 'date-holidays';
import { upsertHoliday } from '@/lib/db';

const singaporeHolidays = new Holidays('SG');
for (let year = 2020; year <= 2040; year += 1) {
  for (const holiday of singaporeHolidays.getHolidays(year)) {
    if (holiday.type !== 'public') continue;
    upsertHoliday(String(holiday.date).slice(0, 10), holiday.name);
  }
}
console.log('Seeded Singapore public holidays for 2020-2040.');