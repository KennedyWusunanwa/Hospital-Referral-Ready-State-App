import { describe, expect, it } from 'vitest'
import {
  firstNameOf,
  greetingFor,
  shiftsOverdueLabel,
  waitingMinutes,
} from '@/features/dashboard/dashboardUtils'

describe('firstNameOf', () => {
  it('uses the first name when there is no title', () => {
    expect(firstNameOf('Ama Boateng')).toBe('Ama')
    expect(firstNameOf('Kwame')).toBe('Kwame')
  })

  it('skips an honorific rather than greeting the title', () => {
    // Regression: this returned "Dr." and the dashboard read "Good morning, Dr."
    expect(firstNameOf('Dr. Ama Boateng')).toBe('Ama')
    expect(firstNameOf('Dr Ama Boateng')).toBe('Ama')
    expect(firstNameOf('Prof. Kwabena Mensah')).toBe('Kwabena')
    expect(firstNameOf('Matron Grace Adjei')).toBe('Grace')
    expect(firstNameOf('Nurse Efua Sarpong')).toBe('Efua')
    expect(firstNameOf('Mrs Akosua Danso')).toBe('Akosua')
  })

  it('is case-insensitive about the honorific', () => {
    expect(firstNameOf('DR. AMA BOATENG')).toBe('AMA')
    expect(firstNameOf('dr ama boateng')).toBe('ama')
  })

  it('falls back sensibly when there is nothing else to use', () => {
    expect(firstNameOf('Dr.')).toBe('Dr.')
    expect(firstNameOf('')).toBe('there')
    expect(firstNameOf('   ')).toBe('there')
    expect(firstNameOf(null)).toBe('there')
    expect(firstNameOf(undefined)).toBe('there')
  })

  it('does not mistake a real name that merely starts like a title', () => {
    expect(firstNameOf('Drake Owusu')).toBe('Drake')
    expect(firstNameOf('Missy Anane')).toBe('Missy')
  })
})

describe('greetingFor', () => {
  const tz = 'Africa/Accra'

  it('changes with the hour in the hospital timezone', () => {
    expect(greetingFor(new Date('2026-09-09T06:00:00Z'), tz)).toBe('Good morning')
    expect(greetingFor(new Date('2026-09-09T11:59:00Z'), tz)).toBe('Good morning')
    expect(greetingFor(new Date('2026-09-09T12:00:00Z'), tz)).toBe('Good afternoon')
    expect(greetingFor(new Date('2026-09-09T16:59:00Z'), tz)).toBe('Good afternoon')
    expect(greetingFor(new Date('2026-09-09T17:00:00Z'), tz)).toBe('Good evening')
  })

  it('respects the timezone, not the viewer', () => {
    // The same instant is morning in Accra and evening in Auckland.
    const instant = new Date('2026-09-09T08:00:00Z')
    expect(greetingFor(instant, 'Africa/Accra')).toBe('Good morning')
    expect(greetingFor(instant, 'Pacific/Auckland')).toBe('Good evening')
  })
})

describe('waitingMinutes', () => {
  const now = new Date('2026-09-09T10:20:00Z')

  it('rounds elapsed minutes', () => {
    expect(waitingMinutes('2026-09-09T10:00:00Z', now)).toBe(20)
    expect(waitingMinutes('2026-09-09T09:50:30Z', now)).toBe(30)
  })

  it('never reports negative waiting time for a clock skew', () => {
    expect(waitingMinutes('2026-09-09T10:40:00Z', now)).toBe(0)
  })

  it('is 0 for an unparseable timestamp rather than NaN', () => {
    expect(waitingMinutes('not-a-date', now)).toBe(0)
  })
})

describe('shiftsOverdueLabel', () => {
  it('describes the backlog in shifts', () => {
    expect(shiftsOverdueLabel(0)).toBe('Reported this shift')
    expect(shiftsOverdueLabel(1)).toBe('1 shift without an update')
    expect(shiftsOverdueLabel(4)).toBe('4 shifts without an update')
    expect(shiftsOverdueLabel(Number.POSITIVE_INFINITY)).toBe('Never submitted')
  })
})
