import { writeFile } from 'fs/promises';
import { join } from 'path';

// --- Constants ---
const NUM_STUDENTS = 10;
const NUM_FACULTY = 4;
const CS_SUBJECTS = [
  { code: 'CSE101', name: 'Structured Programming', type: 'theory', credits: 3 },
  { code: 'CSE102', name: 'Structured Programming Lab', type: 'lab', credits: 1 },
  { code: 'CSE203', name: 'Data Structures', type: 'theory', credits: 3 },
  { code: 'CSE204', name: 'Data Structures Lab', type: 'lab', credits: 1 },
  { code: 'CSE205', name: 'Object Oriented Programming', type: 'theory', credits: 3 },
  { code: 'CSE206', name: 'Object Oriented Programming Lab', type: 'lab', credits: 1 },
  { code: 'CSE301', name: 'Database Management Systems', type: 'theory', credits: 3 },
  { code: 'CSE302', name: 'Database Management Systems Lab', type: 'lab', credits: 1 },
];

const FIRST_NAMES = [
  'Rahim',
  'Karim',
  'Abdul',
  'Fatima',
  'Ayesha',
  'Nusrat',
  'Mohammad',
  'Ahmed',
  'Tanvir',
  'Sadia',
  'Farhana',
  'Kamal',
  'Hassan',
  'Jannat',
  'Sultana',
  'Arif',
  'Rafiq',
  'Shakib',
  'Mahmud',
  'Rubel',
];
const LAST_NAMES = [
  'Islam',
  'Rahman',
  'Uddin',
  'Khan',
  'Ahmed',
  'Chowdhury',
  'Hossain',
  'Ali',
  'Sarkar',
  'Mia',
  'Begum',
  'Akter',
  'Khatun',
  'Haque',
  'Siddique',
];

// --- Helpers ---
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateBangladeshiName() {
  return `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
}

// --- Generators ---
async function main() {
  const users = [];
  const admins = [];
  const faculty = [];
  const students = [];
  const subjects = [];
  const sections = [];
  const enrollments = [];
  const notifications = [];

  // 1. Users & Roles
  // Admin
  users.push({
    id: 'u_admin_1',
    name: 'Admin',
    email: 'admin@uiu.bd',
    role: 'admin',
    emailVerified: 1,
  });
  admins.push({ userId: 'u_admin_1' });

  // Faculty
  for (let i = 1; i <= NUM_FACULTY; i++) {
    const id = `u_fac_${i}`;
    users.push({
      id,
      name: `Prof. ${generateBangladeshiName()}`,
      email: `fac${i}@uiu.bd`,
      role: 'faculty',
      emailVerified: 1,
    });
    faculty.push({ userId: id });
  }

  // Students
  for (let i = 1; i <= NUM_STUDENTS; i++) {
    const id = `u_stu_${i}`;
    users.push({
      id,
      name: generateBangladeshiName(),
      email: `stu${i}@uiu.bd`,
      role: 'student',
      emailVerified: 1,
    });
    students.push({ userId: id, trimesterId: 261 });
  }

  // 2. Subjects
  let subjectIdCounter = 100;
  for (const subj of CS_SUBJECTS) {
    subjectIdCounter++;
    subjects.push({
      id: subjectIdCounter,
      code: subj.code,
      name: subj.name,
      type: subj.type,
      credits: subj.credits,
      published: 1,
    });
  }

  // 3. Sections
  let sectionIdCounter = 1000;
  // Timeslot logic: lineary index 0-29 (5 days * 6 slots)
  // We'll just pick random valid slots.

  for (const subj of subjects) {
    const numSections = randomInt(3, 5);
    const sectionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (let i = 0; i < numSections; i++) {
      sectionIdCounter++;
      // Pick a random faculty
      const fac = randomItem(faculty);

      // Timeslot logic
      let timeslotMask = 0;
      const isLab = subj.type === 'lab';

      if (isLab) {
        // Lab: 2 consecutive slots, start on even index (0, 2, 4) within a day
        const day = randomInt(0, 4);
        const startSlotInDay = randomItem([0, 2, 4]);
        const startAbs = day * 6 + startSlotInDay;
        timeslotMask = (1 << startAbs) | (1 << (startAbs + 1));
      } else {
        // Theory: 1 slot, any slot
        const slot = randomInt(0, 29);
        timeslotMask = 1 << slot;
      }

      sections.push({
        id: sectionIdCounter,
        subjectId: subj.id,
        sectionNumber: sectionLetters[i],
        facultyUserId: fac.userId,
        maxSeats: randomInt(3, 5),
        timeslotMask: timeslotMask,
        published: 1,
      });
    }
  }

  // 4. Enrollments
  // Each student enrolls in 3-5 random subjects
  for (const stu of students) {
    const numEnrollments = randomInt(3, 5);
    const shuffledSubjects = [...subjects].sort(() => 0.5 - Math.random());
    const selectedSubjects = shuffledSubjects.slice(0, numEnrollments);

    for (const subj of selectedSubjects) {
      enrollments.push({
        studentUserId: stu.userId,
        subjectId: subj.id,
      });
    }
  }

  // 5. Phase Schedule
  const now = Date.now();
  const selectionStartMs = now;
  const selectionEndMs = now + 6 * 60 * 60 * 1000; // 6 hours
  const swapStartMs = selectionEndMs + 2; // Right after
  const swapEndMs = swapStartMs + 4 * 60 * 60 * 1000; // 4 hours

  const phaseSchedule = {
    selectionStartMs,
    selectionEndMs,
    swapStartMs,
    swapEndMs,
  };

  // 6. Notifications
  notifications.push({
    createdByUserId: 'u_admin_1',
    audienceRole: null, // Broadcast
    audienceUserId: null,
    title: 'Hello World',
    body: 'Welcome to the new trimester! Selection phase is now open.',
  });

  // Assemble
  const seedData = {
    users,
    admins,
    faculty,
    students,
    subjects,
    sections,
    enrollments,
    phaseSchedule,
    notifications,
    sectionSelections: [],
    _sectionSelections: [], // Empty for now
  };

  // Write to stdout (parent process will redirect)
  console.log(JSON.stringify(seedData, null, 2));
}

main().catch(console.error);
