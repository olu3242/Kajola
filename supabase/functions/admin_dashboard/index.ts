import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') return errorResponse('Method not allowed', 405);

  try {
    const auth = await authenticateRequest(req);
    if (!['tenant_admin', 'super_admin'].includes(auth.role as string)) throw new ApiError('Forbidden', 403);
    const supabase = createSupabaseClient();
    const tenantId = auth.tenant_id as string;
    const refresh = new URL(req.url).searchParams.get('refresh') === 'true';

    if (!refresh && tenantId) {
      const { data: cached } = await supabase
        .from('operator_dashboard_cache')
        .select('metrics, expires_at')
        .eq('tenant_id', tenantId)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (cached?.metrics) return json({ dashboard: cached.metrics, cached: true });
    }

    const dashboard = await buildDashboard(supabase, auth);
    if (tenantId) {
      await supabase.from('operator_dashboard_cache').upsert({
        tenant_id: tenantId,
        metrics: dashboard,
        expires_at: new Date(Date.now() + 60 * 1000).toISOString()
      });
    }
    return json({ dashboard, cached: false });
  } catch (err) {
    return handleError(err);
  }
});

async function buildDashboard(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  const tenantId = auth.tenant_id as string | undefined;
  const tenantFilter = (query: any) => auth.role === 'tenant_admin' && tenantId ? query.eq('tenant_id', tenantId) : query;

  const [
    bookingsToday,
    bookings7d,
    activeUsers,
    totalArtisans,
    verifiedArtisans,
    activeArtisans,
    artisanStats,
    activity7d,
    paymentsToday,
    payments7d,
    successfulPayments,
    subscriptions,
    boosts,
    pendingEvents,
    processedEvents,
    failedEvents,
    retryEvents,
    noResponse,
    slowArtisans,
    unmatchedBookings,
    topBookings,
    services,
    artisans,
    migrations
  ] = await Promise.all([
    count(tenantFilter(supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()))),
    count(tenantFilter(supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()))),
    count(supabase.from('user_activity').select('user_id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString())),
    count(tenantFilter(supabase.from('artisans').select('id', { count: 'exact', head: true }))),
    count(tenantFilter(supabase.from('artisans').select('id', { count: 'exact', head: true }).eq('verified', true))),
    count(tenantFilter(supabase.from('artisans').select('id', { count: 'exact', head: true }).eq('verified', true).eq('is_active', true))),
    supabase.from('artisan_stats').select('artisan_id,total_jobs,completed_jobs,response_time_avg,trust_score').limit(500),
    supabase.from('user_activity').select('event_type, artisan_id, created_at').gte('created_at', sevenDaysAgo.toISOString()).limit(2000),
    tenantFilter(supabase.from('payments').select('amount_cents,created_at,status').eq('status', 'successful').gte('created_at', today.toISOString())),
    tenantFilter(supabase.from('payments').select('amount_cents,created_at,status').eq('status', 'successful').gte('created_at', sevenDaysAgo.toISOString())),
    tenantFilter(supabase.from('payments').select('amount_cents,status').eq('status', 'successful').limit(1000)),
    count(supabase.from('tenants').select('id', { count: 'exact', head: true }).neq('subscription_tier', 'free')),
    count(tenantFilter(supabase.from('featured_listings').select('id', { count: 'exact', head: true }).eq('status', 'active'))),
    count(tenantFilter(supabase.from('system_events').select('id', { count: 'exact', head: true }).eq('status', 'pending'))),
    count(tenantFilter(supabase.from('system_events').select('id', { count: 'exact', head: true }).eq('status', 'processed').gte('created_at', sevenDaysAgo.toISOString()))),
    count(tenantFilter(supabase.from('system_events').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', sevenDaysAgo.toISOString()))),
    count(tenantFilter(supabase.from('system_events').select('id', { count: 'exact', head: true }).gt('retry_count', 0).gte('created_at', sevenDaysAgo.toISOString()))),
    tenantFilter(supabase.from('bookings').select('id, artisan_id, status, created_at').eq('status', 'pending').lt('created_at', threeHoursAgo.toISOString())).limit(100),
    supabase.from('artisan_stats').select('artisan_id,response_time_avg,artisans(business_name)').gt('response_time_avg', 240).order('response_time_avg', { ascending: false }).limit(20),
    tenantFilter(supabase.from('bookings').select('id,status,created_at').is('artisan_id', null)).limit(100),
    tenantFilter(supabase.from('bookings').select('artisan_id, service_id, artisans(business_name, city, state), services(category)').gte('created_at', sevenDaysAgo.toISOString())).limit(2000),
    tenantFilter(supabase.from('services').select('category, artisan_id')).limit(1000),
    tenantFilter(supabase.from('artisans').select('id, business_name, city, state, category')).limit(1000),
    supabase.from('migration_deployments').select('*').order('created_at', { ascending: false }).limit(20)
  ]);

  const activityRows = activity7d.data ?? [];
  const views = activityRows.filter((row: any) => row.event_type === 'view').length;
  const clicks = activityRows.filter((row: any) => row.event_type === 'click').length;
  const bookEvents = activityRows.filter((row: any) => row.event_type === 'book' || row.event_type === 'repeat').length;
  const revenueToday = sum(paymentsToday.data, 'amount_cents');
  const revenue7d = sum(payments7d.data, 'amount_cents');
  const paidRows = successfulPayments.data ?? [];
  const avgBookingValue = paidRows.length ? Math.round(sum(paidRows, 'amount_cents') / paidRows.length) : 0;
  const statsRows = artisanStats.data ?? [];

  const top = topBookings.data ?? [];
  const topArtisans = rankBy(top, (row: any) => row.artisan_id, (row: any) => row.artisans?.business_name ?? 'Unknown artisan');
  const topCategories = rankBy(top, (row: any) => row.services?.category ?? 'Uncategorized', (row: any) => row.services?.category ?? 'Uncategorized');
  const topZones = rankBy(artisans.data ?? [], (row: any) => row.city || row.state || 'Unknown zone', (row: any) => row.city || row.state || 'Unknown zone');

  const automationTotal = pendingEvents + processedEvents + failedEvents;
  const failureRate = automationTotal ? failedEvents / automationTotal : 0;
  const conversionRate = views ? Number(((bookEvents / views) * 100).toFixed(2)) : 0;
  const alerts = [
    bookingsToday === 0 ? { severity: 'warning', message: 'No bookings today' } : null,
    failureRate > 0.1 ? { severity: 'critical', message: 'Automation failure rate is above 10%' } : null,
    views > 20 && conversionRate < 2 ? { severity: 'warning', message: 'Conversion rate has dropped below 2%' } : null,
    noResponse.data?.length ? { severity: 'warning', message: `${noResponse.data.length} booking requests have no response` } : null
    , (migrations.data ?? []).some((row: any) => row.drift_status === 'drift_detected') ? { severity: 'critical', message: 'Schema drift detected in migration pipeline' } : null
  ].filter(Boolean);

  const migrationRows = migrations.data ?? [];
  const latestMigration = migrationRows[0] ?? null;

  return {
    generated_at: now.toISOString(),
    marketplace_health: { bookings_today: bookingsToday, bookings_last_7_days: bookings7d, active_users: activeUsers, active_artisans: activeArtisans },
    conversion_funnel: { views, clicks, bookings: bookEvents, conversion_rate: conversionRate },
    supply_health: {
      total_artisans: totalArtisans,
      verified_artisans: verifiedArtisans,
      active_artisans: activeArtisans,
      avg_response_time: average(statsRows, 'response_time_avg')
    },
    revenue: { revenue_today: revenueToday, revenue_last_7_days: revenue7d, avg_booking_value: avgBookingValue, subscription_count: subscriptions, boost_usage: boosts },
    automation_health: { pending_events: pendingEvents, processed_events: processedEvents, failed_events: failedEvents, retry_count: retryEvents },
    migration_health: {
      applied_migrations: migrationRows.filter((row: any) => row.status === 'applied').length,
      pending_migrations: migrationRows.filter((row: any) => row.status === 'pending').length,
      failed_migrations: migrationRows.filter((row: any) => row.status === 'failed').length,
      drift_status: migrationRows.some((row: any) => row.drift_status === 'drift_detected') ? 'drift_detected' : 'clean',
      last_migration_timestamp: latestMigration?.applied_at ?? latestMigration?.created_at ?? null,
      recent: migrationRows
    },
    liquidity: {
      requests_with_no_response: noResponse.data ?? [],
      slow_response_artisans: slowArtisans.data ?? [],
      unmatched_bookings: unmatchedBookings.data ?? []
    },
    top_performers: { top_artisans: topArtisans, top_categories: topCategories, top_zones: topZones },
    alerts
  };
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query;
  return result.error ? 0 : Number(result.count ?? 0);
}

function sum(rows: any[] | null, key: string) {
  return (rows ?? []).reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function average(rows: any[], key: string) {
  const values = rows.map((row) => Number(row[key] ?? 0)).filter((value) => value > 0);
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
}

function rankBy(rows: any[], keyFn: (row: any) => string, labelFn: (row: any) => string) {
  const map = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const key = keyFn(row) || 'Unknown';
    const current = map.get(key) ?? { label: labelFn(row), count: 0 };
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}
