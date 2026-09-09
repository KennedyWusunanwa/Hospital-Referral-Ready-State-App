/**
 * 404. Unknown paths are redirected to `/404`, so the original address is
 * already gone by the time this renders -- naming it would only be guesswork.
 * The page stays calm and points at the two places people actually want.
 */

import { Link } from 'react-router-dom'
import { ArrowLeftRight, Compass, LayoutDashboard } from 'lucide-react'
import { Card, CardBody } from '@/components/ui'
import { APP_NAME, SUPPORT_EMAIL } from '@/lib/constants'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-16">
      <Card className="w-full">
        <CardBody className="flex flex-col items-center px-6 py-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <Compass className="h-6 w-6" aria-hidden />
          </span>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Error 404
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            This page does not exist
          </h1>
          <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-300">
            The link may be out of date, or the record it pointed at may have been removed. Nothing
            has been lost - pick up where you left off below.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              Back to dashboard
            </Link>
            <Link
              to="/referrals"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              Go to referrals
            </Link>
          </div>

          <p className="hint mt-6">
            Still stuck? Email{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              {SUPPORT_EMAIL}
            </a>{' '}
            and mention what you were doing in {APP_NAME}.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
