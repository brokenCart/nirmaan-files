import { describe, expect, it } from 'vitest'

import {
  assignableRoles,
  availableDecisions,
  canAddArticle,
  canAddReimbursement,
  canAddResource,
  canChangeResource,
  canDeleteArticle,
  canDeleteLog,
  canDeleteReimbursement,
  canEditArticle,
  canEditLog,
  canEditReimbursement,
  canManageRoster,
  canRemoveMember,
  canReviewReimbursement,
  isInOpenTerm,
  isProjectStaff,
  isReimbursementInOpenTerm,
} from '@/api/types'
import type { EffectiveRole } from '@/api/types'
import {
  makeLog,
  makeMembership,
  makeReimbursement,
  makeResource,
  makeSemester,
  makeUser,
} from '@/test/factories'

const ME = 1
const SOMEONE_ELSE = 2

const open = makeSemester({ id: 10, slug: 'open' })
const closed = makeSemester({ id: 9, slug: 'closed', is_current: false })

const mine = makeUser({ id: ME })
const theirs = makeUser({ id: SOMEONE_ELSE })

const ROLES: EffectiveRole[] = ['EXEC', 'LEAD', 'FINANCE_LEAD', 'VOLUNTEER']
const STAFF: EffectiveRole[] = ['EXEC', 'LEAD', 'FINANCE_LEAD']

describe('isProjectStaff', () => {
  it.each(STAFF)('counts %s', (role) => expect(isProjectStaff(role)).toBe(true))
  it.each(['VOLUNTEER', null, undefined] as const)('does not count %s', (role) =>
    expect(isProjectStaff(role)).toBe(false),
  )
})

describe('adding content', () => {
  it.each([
    ['canAddResource', canAddResource],
    ['canAddArticle', canAddArticle],
    ['canAddReimbursement', canAddReimbursement],
  ])('%s needs a role this term', (_name, canAdd) => {
    expect(canAdd('VOLUNTEER')).toBe(true)
    expect(canAdd('EXEC')).toBe(true)
    expect(canAdd(null)).toBe(false)
    expect(canAdd(undefined)).toBe(false)
  })
})

describe('open-term checks', () => {
  it('matches a log on the open term only', () => {
    expect(isInOpenTerm(makeLog({ semester: open.id }), open)).toBe(true)
    expect(isInOpenTerm(makeLog({ semester: closed.id }), open)).toBe(false)
  })

  it('treats an unknown term as closed', () => {
    expect(isInOpenTerm(makeLog(), undefined)).toBe(false)
    expect(isInOpenTerm(makeLog(), null)).toBe(false)
    expect(isReimbursementInOpenTerm(makeReimbursement(), null)).toBe(false)
  })

  it('matches a claim on the open term only', () => {
    expect(isReimbursementInOpenTerm(makeReimbursement({ semester: open.id }), open)).toBe(true)
    expect(isReimbursementInOpenTerm(makeReimbursement({ semester: closed.id }), open)).toBe(false)
  })
})

describe('canEditLog', () => {
  const ownLog = makeLog({ author: mine, semester: open.id })

  it.each(ROLES)('lets the author edit as %s', (role) =>
    expect(canEditLog(ownLog, role, ME, open)).toBe(true),
  )

  it.each(ROLES)('gives %s no edit on someone else’s entry', (role) => {
    const log = makeLog({ author: theirs, semester: open.id })
    expect(canEditLog(log, role, ME, open)).toBe(false)
  })

  it('stops an author who has left the roster', () =>
    expect(canEditLog(ownLog, null, ME, open)).toBe(false))

  it('freezes a closed term, author included', () => {
    const archived = makeLog({ author: mine, semester: closed.id })
    expect(canEditLog(archived, 'LEAD', ME, open)).toBe(false)
  })

  it.each([undefined, null])('offers nothing while the open term is %s', (current) =>
    expect(canEditLog(ownLog, 'VOLUNTEER', ME, current)).toBe(false),
  )

  it('offers nothing with no signed-in user', () =>
    expect(canEditLog(ownLog, 'VOLUNTEER', undefined, open)).toBe(false))
})

describe('canDeleteLog', () => {
  const theirLog = makeLog({ author: theirs, semester: open.id })
  const archived = makeLog({ author: mine, semester: closed.id })

  it.each(['LEAD', 'FINANCE_LEAD'] as const)('lets %s moderate the open term', (role) =>
    expect(canDeleteLog(theirLog, role, false, ME, open)).toBe(true),
  )

  it('lets a volunteer withdraw their own entry', () => {
    const own = makeLog({ author: mine, semester: open.id })
    expect(canDeleteLog(own, 'VOLUNTEER', false, ME, open)).toBe(true)
  })

  it('refuses a volunteer on someone else’s entry', () =>
    expect(canDeleteLog(theirLog, 'VOLUNTEER', false, ME, open)).toBe(false))

  it('refuses a former member', () =>
    expect(canDeleteLog(theirLog, null, false, ME, open)).toBe(false))

  it('keeps exec’s lever over a closed term', () =>
    expect(canDeleteLog(archived, 'EXEC', true, ME, open)).toBe(true))

  // `roleIn` prefers a membership, so this is how an exec who also volunteers
  // on the project arrives. The server decides on `is_exec` alone.
  it.each([
    ['the open term', theirLog],
    ['a closed term', archived],
  ])('honours exec reported as a volunteer on %s', (_term, log) =>
    expect(canDeleteLog(log, 'VOLUNTEER', true, ME, open)).toBe(true),
  )

  it.each(['LEAD', 'FINANCE_LEAD', 'VOLUNTEER'] as const)(
    'stops %s at the term boundary, author or not',
    (role) => expect(canDeleteLog(archived, role, false, ME, open)).toBe(false),
  )
})

describe('assignableRoles', () => {
  it('limits a lead to volunteers', () => expect(assignableRoles(false)).toEqual(['VOLUNTEER']))
  it('lets exec appoint staff', () =>
    expect(assignableRoles(true)).toEqual(['VOLUNTEER', 'FINANCE_LEAD', 'LEAD']))
})

describe('canManageRoster', () => {
  it('lets a lead manage the open term', () =>
    expect(canManageRoster('LEAD', false, open, open)).toBe(true))

  it('stops a lead at a closed term', () =>
    expect(canManageRoster('LEAD', false, closed, open)).toBe(false))

  it('lets exec manage a closed term, whatever role they report', () =>
    expect(canManageRoster('VOLUNTEER', true, closed, open)).toBe(true))

  it.each(['FINANCE_LEAD', 'VOLUNTEER', null] as const)('refuses %s', (role) =>
    expect(canManageRoster(role, false, open, open)).toBe(false),
  )

  it('refuses when no term resolved, exec included', () =>
    expect(canManageRoster('LEAD', true, undefined, open)).toBe(false))
})

describe('canRemoveMember', () => {
  const volunteer = makeMembership({ user: theirs, role: 'VOLUNTEER' })
  const coLead = makeMembership({ user: theirs, role: 'LEAD' })
  const myself = makeMembership({ user: mine, role: 'VOLUNTEER' })

  it('lets a lead remove a volunteer', () =>
    expect(canRemoveMember(volunteer, 'LEAD', false, open, open, ME)).toBe(true))

  it('stops a lead removing staff', () =>
    expect(canRemoveMember(coLead, 'LEAD', false, open, open, ME)).toBe(false))

  it('lets exec remove staff', () =>
    expect(canRemoveMember(coLead, 'EXEC', true, open, open, ME)).toBe(true))

  it.each([
    ['LEAD', false],
    ['EXEC', true],
  ] as const)('never lets %s remove themselves', (role, isExec) =>
    expect(canRemoveMember(myself, role, isExec, open, open, ME)).toBe(false),
  )

  it('stops a lead at a closed term', () =>
    expect(canRemoveMember(volunteer, 'LEAD', false, closed, open, ME)).toBe(false))
})

describe('canChangeResource', () => {
  const theirLink = makeResource({ added_by: theirs })

  it.each(['LEAD', 'FINANCE_LEAD'] as const)('lets %s fix anyone’s link', (role) =>
    expect(canChangeResource(theirLink, role, false, ME)).toBe(true),
  )

  it('lets exec change a link even when reported as a volunteer', () =>
    expect(canChangeResource(theirLink, 'VOLUNTEER', true, ME)).toBe(true))

  it('lets a volunteer change their own link only', () => {
    expect(canChangeResource(makeResource({ added_by: mine }), 'VOLUNTEER', false, ME)).toBe(true)
    expect(canChangeResource(theirLink, 'VOLUNTEER', false, ME)).toBe(false)
  })

  it('refuses a former member who added the link', () =>
    expect(canChangeResource(makeResource({ added_by: mine }), null, false, ME)).toBe(false))
})

describe('article permissions', () => {
  const theirPage = { created_by: theirs }

  it.each(ROLES)('lets %s edit any page', (role) => expect(canEditArticle(role)).toBe(true))
  it('stops a former member editing', () => expect(canEditArticle(null)).toBe(false))

  it('narrows removal to staff and the starter', () => {
    expect(canDeleteArticle(theirPage, 'LEAD', false, ME)).toBe(true)
    expect(canDeleteArticle({ created_by: mine }, 'VOLUNTEER', false, ME)).toBe(true)
    expect(canDeleteArticle(theirPage, 'VOLUNTEER', false, ME)).toBe(false)
  })

  it('lets exec remove a page even when reported as a volunteer', () =>
    expect(canDeleteArticle(theirPage, 'VOLUNTEER', true, ME)).toBe(true))
})

describe('canEditReimbursement', () => {
  const pending = makeReimbursement({ submitted_by: mine, semester: open.id })

  it('lets the submitter edit while pending', () =>
    expect(canEditReimbursement(pending, 'VOLUNTEER', ME, open)).toBe(true))

  it.each(['APPROVED', 'REJECTED'] as const)('stops once %s', (status) => {
    const decided = makeReimbursement({ submitted_by: mine, semester: open.id, status })
    expect(canEditReimbursement(decided, 'VOLUNTEER', ME, open)).toBe(false)
  })

  it.each(ROLES)('gives %s no edit on someone else’s claim', (role) => {
    const claim = makeReimbursement({ submitted_by: theirs, semester: open.id })
    expect(canEditReimbursement(claim, role, ME, open)).toBe(false)
  })

  it('freezes a closed term', () => {
    const archived = makeReimbursement({ submitted_by: mine, semester: closed.id })
    expect(canEditReimbursement(archived, 'VOLUNTEER', ME, open)).toBe(false)
  })
})

describe('canReviewReimbursement', () => {
  const claim = makeReimbursement({ submitted_by: theirs, semester: open.id })
  const archived = makeReimbursement({ submitted_by: theirs, semester: closed.id })

  it('lets the finance lead review', () =>
    expect(canReviewReimbursement(claim, 'FINANCE_LEAD', false, ME, open)).toBe(true))

  it.each(['LEAD', 'VOLUNTEER', null] as const)('refuses %s', (role) =>
    expect(canReviewReimbursement(claim, role, false, ME, open)).toBe(false),
  )

  it.each([
    ['FINANCE_LEAD', false],
    ['EXEC', true],
  ] as const)('never lets %s review their own claim', (role, isExec) => {
    const own = makeReimbursement({ submitted_by: mine, semester: open.id })
    expect(canReviewReimbursement(own, role, isExec, ME, open)).toBe(false)
  })

  it('stops the finance lead at a closed term but not exec', () => {
    expect(canReviewReimbursement(archived, 'FINANCE_LEAD', false, ME, open)).toBe(false)
    expect(canReviewReimbursement(archived, 'VOLUNTEER', true, ME, open)).toBe(true)
  })
})

describe('availableDecisions', () => {
  it.each([
    ['PENDING', ['APPROVED', 'REJECTED']],
    ['APPROVED', ['REJECTED']],
    ['REJECTED', ['APPROVED']],
  ] as const)('offers the decisions that would change a %s claim', (status, expected) =>
    expect(availableDecisions(makeReimbursement({ status }))).toEqual(expected),
  )
})

describe('canDeleteReimbursement', () => {
  const claim = makeReimbursement({ submitted_by: theirs, semester: open.id })
  const decided = makeReimbursement({
    submitted_by: mine,
    semester: open.id,
    status: 'APPROVED',
  })

  it.each(['LEAD', 'FINANCE_LEAD'] as const)('lets %s clear a pending claim', (role) =>
    expect(canDeleteReimbursement(claim, role, false, ME, open)).toBe(true),
  )

  it('lets a volunteer withdraw only their own', () => {
    const own = makeReimbursement({ submitted_by: mine, semester: open.id })
    expect(canDeleteReimbursement(own, 'VOLUNTEER', false, ME, open)).toBe(true)
    expect(canDeleteReimbursement(claim, 'VOLUNTEER', false, ME, open)).toBe(false)
  })

  it('reserves a decided claim for exec', () => {
    expect(canDeleteReimbursement(decided, 'LEAD', false, ME, open)).toBe(false)
    expect(canDeleteReimbursement(decided, 'VOLUNTEER', false, ME, open)).toBe(false)
    expect(canDeleteReimbursement(decided, 'EXEC', true, ME, open)).toBe(true)
  })

  it('honours exec reported as a volunteer on a decided claim', () =>
    expect(canDeleteReimbursement(decided, 'VOLUNTEER', true, ME, open)).toBe(true))

  it('stops staff at a closed term but not exec', () => {
    const archived = makeReimbursement({ submitted_by: theirs, semester: closed.id })
    expect(canDeleteReimbursement(archived, 'LEAD', false, ME, open)).toBe(false)
    expect(canDeleteReimbursement(archived, 'VOLUNTEER', true, ME, open)).toBe(true)
  })
})
