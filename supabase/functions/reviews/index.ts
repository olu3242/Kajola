import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';
import { emitSystemEvent } from '../automation_helpers.ts';

const allowedTags = new Set(['fast', 'professional', 'clean', 'great_value', 'on_time', 'late', 'rude', 'poor_quality']);

serve(async (req: Request) => {
  try {
    const supabase = createSupabaseClient();
    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean);

    if (req.method === 'POST' && path.length === 1) {
      const auth = await authenticateRequest(req);
      return createReview(supabase, auth, await req.json());
    }

    if (req.method === 'GET' && path.length === 3 && path[0] === 'artisans' && path[2] === 'reviews') {
      return listArtisanReviews(supabase, path[1], url.searchParams);
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    return handleError(err);
  }
});

async function createReview(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { booking_id, rating, comment = '', tags = [] } = body;
  if (!booking_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ApiError('booking_id and rating between 1 and 5 are required', 400);
  }
  if (auth.role !== 'client') throw new ApiError('Forbidden', 403);

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', booking_id)
    .single();
  if (bookingError || !booking) throw new ApiError('Booking not found', 404);
  if (booking.status !== 'completed') throw new ApiError('Only completed bookings can be reviewed', 409);
  if (booking.client_id !== auth.sub && booking.user_id !== auth.sub) throw new ApiError('Forbidden', 403);

  const { data: existing } = await supabase.from('reviews').select('id').eq('booking_id', booking_id).maybeSingle();
  if (existing) throw new ApiError('Booking already reviewed', 409);

  const { data: review, error } = await supabase
    .from('reviews')
    .insert({
      tenant_id: booking.tenant_id,
      booking_id,
      user_id: auth.sub,
      client_id: auth.sub,
      artisan_id: booking.artisan_id,
      rating,
      comment
    })
    .select()
    .single();
  if (error || !review) throw new ApiError(error?.message ?? 'Could not create review', 500);

  await emitSystemEvent(supabase, booking.tenant_id, 'review_created', {
    review_id: review.id,
    booking_id,
    artisan_id: review.artisan_id,
    client_id: review.client_id,
    rating
  }, 'reviews', auth.sub, 'review', review.id);

  const cleanTags = Array.isArray(tags)
    ? [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter((tag) => allowedTags.has(tag)))]
    : [];
  if (cleanTags.length > 0) {
    const { error: tagError } = await supabase
      .from('review_tags')
      .insert(cleanTags.map((tag) => ({ review_id: review.id, tag })));
    if (tagError) throw new ApiError(tagError.message, 500);
  }

  const { data: stats } = await supabase.rpc('update_artisan_stats', { target_artisan_id: booking.artisan_id });
  return json({ review: { ...review, tags: cleanTags }, artisan_stats: stats }, 201);
}

async function listArtisanReviews(supabase: ReturnType<typeof createSupabaseClient>, artisanId: string, params: URLSearchParams) {
  const limit = Math.min(Number(params.get('limit') || 20), 50);
  const offset = Number(params.get('offset') || 0);
  const rating = params.get('rating');

  let query = supabase
    .from('reviews')
    .select('id, booking_id, user_id, artisan_id, rating, comment, created_at, review_tags(tag)')
    .eq('artisan_id', artisanId)
    .is('flagged_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (rating) query = query.eq('rating', Number(rating));
  const { data, error } = await query;
  if (error) throw new ApiError(error.message, 500);

  return json({ reviews: data ?? [], pagination: { limit, offset } });
}
