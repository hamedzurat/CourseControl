/**
 * Timeslot Logic:
 * - 7 days a week (Mon=0, Sun=6) -- wait, normally Mon=1 or 0?
 *   Let's assume standard JS Date day: Sun=0, Mon=1.
 *   Actually for academic schedules usually Mon=0 is easier for array mapping.
 *   Let's define: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6.
 *
 * - Slots per day:
 *   Base start: 08:30 AM
 *   Slot duration: 80 mins (1h 20m)
 *   Break? Usually 10-20 mins. Let's assume contiguous for simplicity unless specified.
 *   Actually user said "each slot is 1 hour 20 min".
 *   Let's assume standard slots:
 *   0: 08:30 - 09:50
 *   1: 10:00 - 11:20 (10 min break)
 *   2: 11:30 - 12:50
 *   3: 13:00 - 14:20
 *   4: 14:30 - 15:50
 *   5: 16:00 - 17:20
 *
 * - Bitmask:
 *   Day (3 bits) | Slot (4 bits) ?
 *   Or simple linear index?
 *   If the mask is an integer, typically bits represent slots.
 *   Let's assume the previous system (if any) or define a new one.
 *   If the backend sends a "timeslotMask" (number), it might be a bitfield where each bit is a slot.
 *   e.g. bit 0 = Mon Slot 0, bit 1 = Mon Slot 1...
 *   Or encoded as (day * 100 + slot).
 *   Let's assume bitfield for safety or packed int.
 *
 *   Actually, let's look at what we have. If it's just an integer, and we need to show it...
 *   Let's assume it is (day * 10) + slot index.
 *   e.g. 0 = Mon 08:30, 1 = Mon 10:00.
 *   10 = Tue 08:30 (if 0-based day)
 *
 *   Wait, the user just said "timeslotMask is being shown as number".
 *   I'll assume a packed format: `day << 8 | slot`.
 *   Or better, let's just make a utility that takes the raw number and formatting it nicely,
 *   assuming it MIGHT serve as an index into a predefined list if small,
 *   or a packed struct.
 *
 *   Let's assume:
 *   Input: number
 *   If < 100: It's likely just a slot index in a linear week.
 *   Linear: Mon(0-5), Tue(6-11), etc.
 *
 *   Let's implement a standard linear mapping:
 *   Day = floor(mask / 6)
 *   Slot = mask % 6
 *
 *   Days: Mon, Tue, Wed, Thu, Fri, Sat, Sun
 *   Times:
 *   0: 08:30 - 09:50
 *   1: 10:00 - 11:20
 *   2: 11:30 - 12:50
 *   3: 13:00 - 14:20
 *   4: 14:30 - 15:50
 *   5: 16:00 - 17:20
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SLOT_TIMES = [
  { start: '08:30', end: '09:50' },
  { start: '10:00', end: '11:20' },
  { start: '11:30', end: '12:50' },
  { start: '13:00', end: '14:20' },
  { start: '14:30', end: '15:50' },
  { start: '16:00', end: '17:20' },
];

export function formatTimeslot(mask: number): string {
  // Assume mask is a linear index for now (0 = Mon 08:30)
  // If it's a bitmask, this function would need to return arrays, but UI usually shows one primary slot per section row
  // or a list. Let's assume 1-to-1 for simplicity or return a string for the first match.

  const dayIdx = Math.floor(mask / 6);
  const slotIdx = mask % 6;

  if (dayIdx < 0 || dayIdx >= DAYS.length) return 'TBA';
  const day = DAYS[dayIdx];

  const time = SLOT_TIMES[slotIdx];
  if (!time) return `${day} (Unknown Time)`;

  return `${day} ${time.start} - ${time.end}`;
}

export function hasTimeConflict(a: number, b: number): boolean {
  return (a & b) !== 0;
}

export function getAllTimeslots() {
  const slots = [];
  for (let d = 0; d < 5; d++) {
    // Mon-Fri
    for (let s = 0; s < 6; s++) {
      slots.push({
        value: d * 6 + s,
        label: `${DAYS[d]} ${SLOT_TIMES[s].start}`,
      });
    }
  }
  return slots;
}
