import { NextResponse } from 'next/server';
import { getPineconeIndex } from '@/utils/pinecone';

type QueryMatch = {
  id: string;
  score?: number;
  metadata?: {
    tl_video_id?: string;
    tl_index_id?: string;
    scope?: string;
    [key: string]: unknown;
  };
  values?: number[];
  resultType?: string;
};

export async function POST(req: Request) {
  try {
    const { videoId, indexId } = await req.json();
    const index = getPineconeIndex();

    // First, get the original video's clip embedding
    const originalClipQuery = await index.query({
      filter: {
        tl_video_id: videoId,
        scope: 'clip'
      },
      topK: 100,
      includeMetadata: true,
      includeValues: true,
      vector: new Array(1024).fill(0)
    });

    // If we found matching clips, search for similar ads for each match
    const similarResults = [];
    if (originalClipQuery.matches.length > 0) {
      for (const originalClip of originalClipQuery.matches) {
        const vectorValues = originalClip.values || new Array(1024).fill(0);
        const queryResult = await index.query({
          vector: vectorValues,
          filter: {
            tl_index_id: indexId,
            scope: 'clip'
          },
          topK: 5,
          includeMetadata: true,
        });
        similarResults.push(queryResult);
      }
    }

    // Merge and organize results - combine all matches from all results
    let allResults: QueryMatch[] = [];

    // Process each result in the similarResults array
    for (const result of similarResults) {
      if (result && 'matches' in result && Array.isArray(result.matches)) {
        const formattedMatches = result.matches.map(match => ({
          ...match,
          resultType: 'clip'
        }));
        allResults = [...allResults, ...formattedMatches];
      }
    }

    // Remove duplicates (keep only the highest score for each tlVideoId)
    const uniqueResults = Object.values(
      allResults.reduce((acc: Record<string, typeof current>, current) => {
        const tlVideoId = current.metadata?.tl_video_id as string;
        if (!tlVideoId) return acc;

        if (!acc[tlVideoId] || (acc[tlVideoId].score ?? 0) < (current.score ?? 0)) {
          acc[tlVideoId] = current;
        }
        return acc;
      }, {})
    );
    
    // Sort by score
    const sortedResults = uniqueResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return NextResponse.json(sortedResults);

  } catch (error) {
    console.error('Error in embedding search:', error);
    return NextResponse.json(
      { error: 'Failed to process embedding search' },
      { status: 500 }
    );
  }
}