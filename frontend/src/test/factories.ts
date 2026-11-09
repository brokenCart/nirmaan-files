/**
 * API rows for tests, typed against the generated schema so that a renamed
 * serializer field breaks these too.
 */
import type {
  ArchiveTerm,
  Article,
  ArticleListItem,
  ArticleRevision,
  AttendanceRow,
  DailyLog,
  LogImage,
  LogVideo,
  Membership,
  Project,
  Reimbursement,
  ReimbursementSummary,
  Resource,
  Semester,
  User,
} from '@/api/types'

const TIMESTAMP = '2026-08-01T10:30:00Z'

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'f20250001@pilani.bits-pilani.ac.in',
    full_name: 'Aarav Sharma',
    avatar_url: '',
    is_exec: false,
    has_signed_in: true,
    ...overrides,
  }
}

export function makeSemester(overrides: Partial<Semester> = {}): Semester {
  return {
    id: 10,
    name: 'First Semester 2026-27',
    slug: '2026-27-1',
    starts_on: '2026-08-01',
    ends_on: '2026-12-15',
    is_current: true,
    created_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 100,
    name: 'Shiksha',
    slug: 'shiksha',
    description: 'Teaching at the community centre.',
    is_active: true,
    member_count: 3,
    my_role: 'VOLUNTEER',
    image_uploads_enabled: true,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 200,
    user: makeUser(),
    project: 100,
    semester: 10,
    semester_slug: '2026-27-1',
    role: 'VOLUNTEER',
    is_active: true,
    joined_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
  return {
    id: 300,
    project: 100,
    project_slug: 'shiksha',
    semester: 10,
    semester_slug: '2026-27-1',
    kind: 'MOV',
    title: 'Saturday session',
    body: 'Ran the weekly session.',
    occurred_on: '2026-08-01',
    hours: 1,
    attendees: [],
    images: [],
    videos: [],
    author: makeUser(),
    status: 'PUBLISHED',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeLogImage(overrides: Partial<LogImage> = {}): LogImage {
  return {
    id: 350,
    original_name: 'visit.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1024,
    url: '/api/log-images/350/content/?exp=1&sig=a',
    thumbnail_url: '/api/log-images/350/content/?exp=1&sig=a&variant=thumbnail',
    ...overrides,
  }
}

export function makeLogVideo(overrides: Partial<LogVideo> = {}): LogVideo {
  return {
    id: 360,
    original_name: 'visit.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
    url: '/api/log-videos/360/content/?exp=1&sig=a',
    poster_url: '/api/log-videos/360/content/?exp=1&sig=a&variant=thumbnail',
    ...overrides,
  }
}

export function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 400,
    project: 100,
    project_slug: 'shiksha',
    kind: 'FOLDER',
    title: 'Project Drive folder',
    url: 'https://drive.google.com/drive/folders/abc',
    description: 'Everything lives here.',
    added_by: makeUser(),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeReimbursement(overrides: Partial<Reimbursement> = {}): Reimbursement {
  return {
    id: 500,
    project: 100,
    project_slug: 'shiksha',
    semester: 10,
    semester_slug: '2026-27-1',
    title: 'Bus fare',
    amount: '480.50',
    description: 'Return tickets.',
    receipts: [],
    status: 'PENDING',
    submitted_by: makeUser(),
    reviewed_by: null,
    reviewed_at: null,
    review_note: '',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeReimbursementSummary(
  overrides: Partial<ReimbursementSummary> = {},
): ReimbursementSummary {
  return {
    PENDING: { count: 0, total: '0.00' },
    APPROVED: { count: 0, total: '0.00' },
    REJECTED: { count: 0, total: '0.00' },
    ...overrides,
  }
}

export function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 600,
    project: 100,
    project_slug: 'shiksha',
    category: 'PROCESS',
    title: 'How the Saturday session runs',
    body: 'Start at **ten**.',
    revision_count: 1,
    created_by: makeUser(),
    updated_by: makeUser(),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeArticleListItem(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 600,
    project: 100,
    project_slug: 'shiksha',
    category: 'PROCESS',
    title: 'How the Saturday session runs',
    excerpt: 'Start at ten.',
    revision_count: 1,
    created_by: makeUser(),
    updated_by: makeUser(),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeRevision(overrides: Partial<ArticleRevision> = {}): ArticleRevision {
  return {
    id: 700,
    title: 'How the Saturday session runs',
    body: 'Start at ten.',
    category: 'PROCESS',
    edited_by: makeUser(),
    note: '',
    created_at: TIMESTAMP,
    ...overrides,
  }
}

export function makeArchiveTerm(overrides: Partial<ArchiveTerm> = {}): ArchiveTerm {
  return {
    semester: makeSemester(),
    visits: 0,
    meetings: 0,
    member_count: 0,
    leads: [],
    ...overrides,
  }
}

export function makeAttendanceRow(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    user: makeUser(),
    role: 'VOLUNTEER',
    visits: 0,
    meetings: 0,
    total: 0,
    hours: 0,
    ...overrides,
  }
}
