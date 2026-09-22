import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageIcon, Palette, RotateCcw, Trash2, Upload } from 'lucide-react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
} from '@/components/ui'
import {
  DEFAULT_BRAND_COLOR,
  applyBrandColor,
  buildBrandScale,
  isValidHex,
  rgbToHex,
  whiteContrast,
} from '@/lib/branding'
import { rowToBranding, useAppSettings } from '@/features/branding/useBranding'
import { formatDateTime } from '@/lib/utils'
import {
  ACCEPTED_LOGO_TYPES,
  MAX_LOGO_BYTES,
  useUpdateAppSettings,
  useUploadLogo,
} from './useAppSettings'

/** Starting points that already read as clinical rather than decorative. */
const PRESETS: { label: string; value: string }[] = [
  { label: 'Clinical blue', value: '#1b5cf5' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Crimson', value: '#e11d48' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Graphite', value: '#475569' },
]

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

function RampPreview({ color }: { color: string }) {
  const scale = buildBrandScale(color)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex">
        {STOPS.map((stop) => (
          <div
            key={stop}
            className="h-10 flex-1"
            style={{ backgroundColor: rgbToHex(scale[stop]) }}
            title={`${stop} - ${rgbToHex(scale[stop])}`}
          />
        ))}
      </div>
      <div className="flex bg-white dark:bg-slate-900">
        {STOPS.map((stop) => (
          <div
            key={stop}
            className="flex-1 py-1 text-center text-[10px] tabular-nums text-slate-400"
          >
            {stop}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AppearanceSettings() {
  const settings = useAppSettings()
  const update = useUpdateAppSettings()
  const uploadLogo = useUploadLogo()
  const fileInput = useRef<HTMLInputElement>(null)

  const saved = rowToBranding(settings.data ?? null)
  const savedColorRef = useRef(saved.brandColor)

  const [color, setColor] = useState(saved.brandColor)
  const [logoUrl, setLogoUrl] = useState<string | null>(saved.logoUrl)
  const [appName, setAppName] = useState(saved.appName)
  const [appTagline, setAppTagline] = useState(saved.appTagline)
  const [supportEmail, setSupportEmail] = useState(saved.supportEmail)

  // Re-seed the form once the query resolves.
  useEffect(() => {
    if (!settings.data) return
    const next = rowToBranding(settings.data)
    savedColorRef.current = next.brandColor
    setColor(next.brandColor)
    setLogoUrl(next.logoUrl)
    setAppName(next.appName)
    setAppTagline(next.appTagline)
    setSupportEmail(next.supportEmail)
  }, [settings.data])

  // Paint the whole app in the candidate colour while it is being chosen, and
  // put the saved one back if the administrator navigates away without saving.
  useEffect(() => {
    if (isValidHex(color)) applyBrandColor(color)
  }, [color])

  useEffect(() => {
    return () => {
      applyBrandColor(savedColorRef.current)
    }
  }, [])

  if (settings.isLoading) {
    return (
      <Card>
        <LoadingBlock rows={4} />
      </Card>
    )
  }

  if (settings.isError) {
    return <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} />
  }

  const settingsMissing = settings.data === null
  const validColor = isValidHex(color)
  const contrast = whiteContrast(color)
  const lowContrast = validColor && contrast < 4.5
  const dirty =
    color !== saved.brandColor ||
    logoUrl !== saved.logoUrl ||
    appName !== saved.appName ||
    appTagline !== saved.appTagline ||
    supportEmail !== saved.supportEmail

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = await uploadLogo.mutateAsync(file)
      setLogoUrl(result.publicUrl)
      toast.success('Logo uploaded. Save to apply it.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const onSave = async () => {
    if (!validColor) {
      toast.error('Enter a colour as a 6-digit hex value, for example #1b5cf5.')
      return
    }
    try {
      await update.mutateAsync({
        brand_color: color,
        logo_url: logoUrl,
        app_name: appName.trim(),
        app_tagline: appTagline.trim(),
        support_email: supportEmail.trim() || null,
      })
      savedColorRef.current = color
      toast.success('Appearance saved for everyone on the network')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const onResetDefaults = () => {
    setColor(DEFAULT_BRAND_COLOR)
    setLogoUrl(null)
  }

  return (
    <div className="space-y-5">
      {settingsMissing && (
        <Alert tone="warning" title="Branding table not found">
          This deployment has not run <code className="font-mono text-xs">0005_settings_and_invites.sql</code>{' '}
          yet, so changes cannot be saved. Run it in the Supabase SQL editor, then reload.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Brand colour"
          description="Used for buttons, links, active navigation and charts across the whole network."
          action={<Palette className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setColor(preset.value)}
                aria-label={preset.label}
                aria-pressed={color.toLowerCase() === preset.value.toLowerCase()}
                className={
                  'tap-target flex items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ' +
                  (color.toLowerCase() === preset.value.toLowerCase()
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800')
                }
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: preset.value }}
                  aria-hidden
                />
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="shrink-0">
              <label className="field-label mb-1.5" htmlFor="brand-color-swatch">
                Pick
              </label>
              <input
                id="brand-color-swatch"
                type="color"
                value={validColor ? color : DEFAULT_BRAND_COLOR}
                onChange={(event) => setColor(event.target.value)}
                className="h-11 w-16 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <Field
              label="Hex value"
              error={validColor ? null : 'Use a 6-digit hex value, for example #1b5cf5.'}
              className="w-full sm:max-w-48"
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={color}
                  spellCheck={false}
                  onChange={(event) => setColor(event.target.value.trim())}
                  placeholder="#1b5cf5"
                />
              )}
            </Field>
            <Button variant="outline" onClick={onResetDefaults} className="sm:mb-0.5">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Defaults
            </Button>
          </div>

          <div>
            <p className="field-label mb-1.5">Derived shades</p>
            <RampPreview color={validColor ? color : DEFAULT_BRAND_COLOR} />
            <p className="mt-1.5 hint">
              You choose one colour; the other ten shades are derived from it so hover, border and
              dark-mode states stay consistent. The change above is already previewed live.
            </p>
          </div>

          {lowContrast && (
            <Alert tone="warning" title="White button text will be hard to read">
              White on this colour scores {contrast.toFixed(1)}:1, below the 4.5:1 that WCAG AA asks
              for. Button text switches to dark automatically, but a darker brand colour reads
              better on screens in a bright ward.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <span className="hint">Preview:</span>
            <Button size="sm">Primary action</Button>
            <Button size="sm" variant="outline">
              Secondary
            </Button>
            <a href="#preview" className="text-sm font-medium text-brand-600 dark:text-brand-400">
              A link
            </a>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Logo"
          description="Shown in the sidebar and on the sign-in screen. PNG, SVG, JPEG or WebP, under 1 MB."
          action={<ImageIcon className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {logoUrl ? (
                <img src={logoUrl} alt="Current logo" className="h-full w-full object-contain" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-brand-fg">
                  {appName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_LOGO_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => void onPickFile(event.target.files?.[0])}
              />
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                loading={uploadLogo.isPending}
              >
                <Upload className="h-4 w-4" aria-hidden />
                {logoUrl ? 'Replace' : 'Upload'}
              </Button>
              {logoUrl && (
                <Button variant="ghost" onClick={() => setLogoUrl(null)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Remove
                </Button>
              )}
            </div>
          </div>
          <p className="hint">
            With no logo the app falls back to the first two letters of the name on a brand-coloured
            tile. Maximum {(MAX_LOGO_BYTES / 1024 / 1024).toFixed(0)} MB.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Naming" description="How the app refers to itself throughout." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Application name" hint="Shown in the sidebar and browser tab.">
            {({ id }) => (
              <Input
                id={id}
                value={appName}
                maxLength={40}
                onChange={(event) => setAppName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Tagline" hint="The line under the name in the sidebar.">
            {({ id }) => (
              <Input
                id={id}
                value={appTagline}
                maxLength={60}
                onChange={(event) => setAppTagline(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Support email"
            hint="Offered to people who cannot sign in."
            className="sm:col-span-2"
          >
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={supportEmail}
                onChange={(event) => setSupportEmail(event.target.value)}
              />
            )}
          </Field>
        </CardBody>
        <CardFooter className="justify-between">
          <p className="hint">
            {settings.data?.updated_at
              ? `Last changed ${formatDateTime(settings.data.updated_at)}`
              : 'Not changed yet'}
          </p>
          <Button onClick={() => void onSave()} loading={update.isPending} disabled={!dirty || settingsMissing}>
            Save appearance
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
