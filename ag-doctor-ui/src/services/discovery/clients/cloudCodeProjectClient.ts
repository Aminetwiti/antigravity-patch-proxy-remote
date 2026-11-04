/**
 * cloudCodeProjectClient.ts — Discovery of Google Cloud Code companion & GCP projects.
 */

import { CloudCodeProjectInfo } from '../discoveryTypes';

/**
 * Discovers existing Cloud Code companion project, or triggers automatic onboarding if not found.
 */
export async function ensureCloudCodeProject(accessToken: string): Promise<CloudCodeProjectInfo | null> {
  const baseUrls = [
    'https://daily-cloudcode-pa.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ];

  for (const baseUrl of baseUrls) {
    try {
      const platformNum = process.platform === 'win32' ? 5 : (process.platform === 'darwin' ? 2 : 3);
      const metadataPayload = {
        ideType: 9,
        ide_type: 'ANTIGRAVITY',
        pluginType: 2,
        plugin_type: 2,
        platform: platformNum,
        ideName: 'antigravity',
        ide_name: 'antigravity',
      };

      // 1. Try loadCodeAssist
      const loadRes = await fetch(`${baseUrl}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({ metadata: metadataPayload }),
        signal: AbortSignal.timeout(6000),
      });

      if (loadRes.ok) {
        const loadData = (await loadRes.json()) as any;
        let accountEmail: string | undefined;
        if (loadData.manageSubscriptionUri) {
          const emailMatch = loadData.manageSubscriptionUri.match(/Email=([^&]+)/);
          if (emailMatch) {
            accountEmail = decodeURIComponent(emailMatch[1]);
          }
        }

        const defaultTier = loadData.allowedTiers?.find((tier: any) => tier.isDefault);
        const baseTier = defaultTier?.id || 'free-tier';
        const tierId = loadData.paidTier?.name ? `${loadData.paidTier.name}(${baseTier.replace('-tier', '')})` : baseTier;

        if (loadData.cloudaicompanionProject) {
          return {
            projectId: loadData.cloudaicompanionProject,
            tierId,
            accountEmail,
          };
        }

        // 2. If project not yet onboarded, trigger auto-onboarding
        const onboardRes = await fetch(`${baseUrl}/v1internal:onboardUser`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity',
          },
          body: JSON.stringify({
            tierId: baseTier,
            cloudaicompanionProject: 'aicode-consumers',
            metadata: metadataPayload,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (onboardRes.ok) {
          const onboardData = (await onboardRes.json()) as any;
          const discoveredId = onboardData.response?.cloudaicompanionProject?.id || onboardData.name;
          if (discoveredId) {
            return {
              projectId: discoveredId,
              tierId,
              accountEmail,
            };
          }
        }
      }
    } catch {
      // Try next base URL on network/timeout error
    }
  }

  // Fallback: If no companion project returned (e.g. Gemini CLI token), discover user's GCP project
  try {
    const gcpProject = await ensureGeminiCliGcpProject(accessToken);
    if (gcpProject) {
      return {
        projectId: gcpProject,
        tierId: 'free-tier',
      };
    }
  } catch {
    // Ignore fallback error
  }

  return null;
}

/**
 * Discovers the active Google Cloud project for a Gemini CLI token and ensures required APIs are enabled.
 */
export async function ensureGeminiCliGcpProject(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'antigravity',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const projects = data?.projects || [];
      const active = projects.filter((p: any) => p?.lifecycleState === 'ACTIVE');
      if (active.length > 0) {
        const projectId = active[0].projectId;
        const services = ['cloudaicompanion.googleapis.com', 'geminicloudassist.googleapis.com'];
        for (const svc of services) {
          fetch(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${svc}:enable`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity',
            },
            body: '{}',
          }).catch(() => {});
        }
        return projectId;
      }
    }
  } catch {
    // Ignore error
  }
  return null;
}
