import { NextResponse } from 'next/server';
import { getPineconeIndex } from '@/utils/pinecone';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get('videoId');
    const indexId = searchParams.get('indexId');

    if (!videoId || !indexId) {
      console.error('🔍 CHECK-STATUS - Missing required parameters');
      return NextResponse.json(
        { processed: false, error: 'videoId and indexId are required parameters' },
        { status: 400 }
      );
    }

    console.log(`🔍 CHECK-STATUS - Checking if video ${videoId} exists in index ${indexId}`);

    // Determine category based on indexId
    const isAdsIndex = indexId.toLowerCase().includes('ad');
    const category = isAdsIndex ? 'ad' : 'content';
    console.log(`🔍 CHECK-STATUS - Using category "${category}" for index ${indexId}`);

    // Get Pinecone index
    const pineconeIndex = getPineconeIndex();

    if (!pineconeIndex) {
      console.error('🔍 CHECK-STATUS - Failed to get Pinecone index');
      return NextResponse.json(
        { processed: false, error: 'Failed to get Pinecone index', category },
        { status: 500 }
      );
    }

    try {
      // Query for vectors with this video ID
      console.log(`🔍 CHECK-STATUS - Querying Pinecone for video ${videoId}`);

      // Use a zero vector with correct dimensions (1024) - only using filter to find vectors
      const queryResponse = await pineconeIndex.query({
        vector: Array(1024).fill(0), // Zero vector with 1024 dimensions to match the index dimension
        filter: { tl_video_id: videoId },
        topK: 1,
        includeMetadata: true
      });

      const matchCount = queryResponse.matches?.length || 0;
      const processed = Boolean(matchCount);

      // Log basic query results
      console.log(`🔍 CHECK-STATUS - Query result for ${videoId}: ${processed ? "FOUND" : "NOT FOUND"}`);

      // If found, log the first match details
      if (processed && queryResponse.matches && queryResponse.matches[0]) {
        const firstMatch = queryResponse.matches[0];
        console.log(`🔍 CHECK-STATUS - First match info:`, JSON.stringify({
          id: firstMatch.id,
          metadata: firstMatch.metadata
        }, null, 2));
      }

      return NextResponse.json({
        processed,
        source: 'pinecone',
        category,
        videoId,
        indexId,
        matches_count: matchCount,
        debug_info: {
          query_time: new Date().toISOString(),
          has_matches: processed,
          first_match_id: queryResponse.matches?.[0]?.id,
          first_match_metadata: queryResponse.matches?.[0]?.metadata
        }
      });
    } catch (error) {
      console.error(`🔍 CHECK-STATUS - Error checking if video ${videoId} is processed:`, error);
      return NextResponse.json(
        {
          processed: false,
          error: 'Failed to check processing status',
          category,
          error_details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('🔍 CHECK-STATUS - Error checking video processing status:', error);
    return NextResponse.json(
      { processed: false, error: 'Server error checking processing status' },
      { status: 500 }
    );
  }
}