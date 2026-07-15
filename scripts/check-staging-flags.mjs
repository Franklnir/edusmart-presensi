import { readFile } from 'node:fs/promises'

const workflow = await readFile('.github/workflows/staging.yml', 'utf8')
const cloudflareWorkflow = await readFile('.github/workflows/cloudflare-pages-staging.yml', 'utf8')
const dockerfile = await readFile('deploy/nginx/Dockerfile.prod', 'utf8')
const productionExample = await readFile('.env.production.example', 'utf8')

const flags = {
  STAGING_USE_GRADES_API_V2: 'true',
  STAGING_USE_REPORT_CARDS_API_V2: 'true',
  STAGING_USE_SCHEDULES_API_V2: 'false',
  STAGING_USE_ASSIGNMENTS_API_V2: 'false',
  STAGING_USE_ASSIGNMENT_UPLOADS_API_V2: 'false',
  STAGING_USE_CLASSES_API_V2: 'false',
  STAGING_USE_ATTENDANCE_API_V2: 'false',
  STAGING_USE_ANNOUNCEMENTS_API_V2: 'false'
}

const failures = []

for (const [stagingName, defaultValue] of Object.entries(flags)) {
  const frontendName = stagingName.replace(/^STAGING_/, 'VITE_')
  const envPattern = new RegExp(
    `${stagingName}:[\\s\\S]{0,160}vars\\.${stagingName} \\|\\| '${defaultValue}'`
  )

  if (!envPattern.test(workflow)) {
    failures.push(`${stagingName}: staging env must declare an explicit default of '${defaultValue}'`)
  }

  if (!workflow.includes(`--build-arg ${frontendName}="$${stagingName}"`)) {
    failures.push(`${frontendName}: staging Docker build arg is missing`)
  }

  if (!workflow.includes(`${frontendName}=$${stagingName}`)) {
    failures.push(`${frontendName}: runtime staging environment entry is missing`)
  }

  const cloudflareExpression = frontendName + ": ${{ vars." + stagingName + " || '" + defaultValue + "' }}"
  if (!cloudflareWorkflow.includes(cloudflareExpression)) {
    failures.push(`${frontendName}: Cloudflare Pages staging environment entry is missing or has the wrong default`)
  }

  const evidenceName = frontendName.toLowerCase()
    .replaceAll('vite_', '')
    .replaceAll('use_', '')
    .replaceAll('_api_v2', '_v2')
  if (!workflow.includes(`echo "${evidenceName}=$${stagingName}"`)) {
    failures.push(`${frontendName}: release evidence entry is missing`)
  }

  if (!dockerfile.includes(`ARG ${frontendName}=`) || !dockerfile.includes(`ENV ${frontendName}=`)) {
    failures.push(`${frontendName}: Dockerfile ARG/ENV declaration is missing`)
  }
}

if (!workflow.includes('--build-arg VITE_APP_RELEASE_SHA="$RELEASE_SHA"')) {
  failures.push('VITE_APP_RELEASE_SHA: backend/nginx staging build arg is missing')
}

if (!cloudflareWorkflow.includes('VITE_APP_RELEASE_SHA: ${{ github.sha }}')) {
  failures.push('VITE_APP_RELEASE_SHA: Cloudflare Pages release metadata is missing')
}

if (!dockerfile.includes('ARG VITE_APP_RELEASE_SHA=') || !dockerfile.includes('ENV VITE_APP_RELEASE_SHA=')) {
  failures.push('VITE_APP_RELEASE_SHA: nginx Dockerfile declaration is missing')
}

if (!productionExample.includes('VITE_APP_RELEASE_SHA=')) {
  failures.push('VITE_APP_RELEASE_SHA: production environment example is missing')
}

for (const frontendName of Object.keys(flags).map((name) => name.replace(/^STAGING_/, 'VITE_'))) {
  if (!productionExample.includes(`${frontendName}=`)) {
    failures.push(`${frontendName}: production environment example is missing`)
  }
}

if (failures.length > 0) {
  console.error('Staging flag matrix failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Staging flag matrix passed: ${Object.keys(flags).length} explicit V2 flags verified.`)
