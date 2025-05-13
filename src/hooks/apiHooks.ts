import { PaginatedResponse } from '@/types';
import { EmbeddingResponse } from '@/types/index';

// 비디오 목록 가져오기
export const fetchVideos = async (
  page: number = 1,
  indexId?: string
): Promise<PaginatedResponse> => {
  if (!indexId) {
    throw new Error('Index ID is required');
  }

  try {
    const response = await fetch(`/api/videos?page=${page}&index_id=${indexId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching videos:', error);
    throw error;
  }
};

// 비디오 상세 정보 타입 정의
export interface VideoDetailResponse {
  _id: string;
  index_id?: string;
  hls?: {
    video_url?: string;
    thumbnail_urls?: string[];
    status?: string;
    updated_at?: string;
  };
  system_metadata?: {
    filename?: string;
    video_title?: string;
    duration?: number;
    fps?: number;
    height?: number;
    width?: number;
    size?: number;
  };
  user_metadata?: Record<string, string>;
}

// 비디오 상세 정보 가져오기
export const fetchVideoDetails = async (videoId: string, indexId: string, embed: boolean = false) => {
  try {
    const response = await fetch(`/api/videos/${videoId}?indexId=${indexId}&embed=${embed}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Network response was not ok: ${errorText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching video details:', error);
    // Just rethrow for now, the API endpoint will handle fallback to dummy data
    throw error;
  }
};

// 비디오 처리 상태 확인 - 카테고리 정보 포함
export interface ProcessingStatusResponse {
  processed: boolean;
  source?: string;
  category?: string;
  videoId?: string;
  indexId?: string;
  error?: string;
}

// 비디오 처리 상태 확인 함수
export const checkProcessingStatus = async (
  videoId: string,
  indexId: string
): Promise<ProcessingStatusResponse> => {
  try {
    const url = new URL('/api/vectors/check-status', window.location.origin);
    url.searchParams.append('videoId', videoId);
    url.searchParams.append('indexId', indexId);

    console.log(`Checking processing status for video ${videoId} in index ${indexId}`);
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error(`Error checking processing status: HTTP status ${response.status}`);
      return {
        processed: false,
        error: `HTTP error ${response.status}`,
        // Determine category based on indexId even when API fails
        category: indexId.toLowerCase().includes('ad') ? 'ad' : 'content'
      };
    }

    const data = await response.json();
    console.log(`Processing status for video ${videoId}:`, JSON.stringify(data));

    // 중요: 정확히 processed 값이 무엇인지 명확하게 로깅
    console.log(`Video ${videoId} processed status is explicitly: ${Boolean(data.processed)}`);

    // 벡터가 없을 때 임베딩 생성 명시적 로깅
    if (!data.processed) {
      console.log(`### IMPORTANT: Video ${videoId} is NOT processed. Will attempt to create embedding.`);
    } else {
      console.log(`### CONFIRMED: Video ${videoId} is already processed. No need to create embedding.`);
    }

    return data;
  } catch (error) {
    console.error('Error checking processing status:', error);
    // In case of error, return processed=false with category determination
    return {
      processed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      // Still determine category based on indexId
      category: indexId.toLowerCase().includes('ad') ? 'ad' : 'content'
    };
  }
};

// 벡터 인덱스 존재 여부 확인
export const checkVectorExists = async (videoId: string, indexId?: string): Promise<boolean> => {
  try {
    const url = new URL('/api/vectors/exists', window.location.origin);
    url.searchParams.append('video_id', videoId);
    if (indexId) {
      url.searchParams.append('index_id', indexId);
    }

    console.log(`Checking if vector exists for video ${videoId}${indexId ? ` in index ${indexId}` : ''}`);
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error(`Error checking vector: HTTP status ${response.status}`);
      return false;
    }

    const data = await response.json();
    console.log(`Vector exists for video ${videoId}: ${data.exists}`);
    return data.exists;
  } catch (error) {
    console.error('Error checking vector existence:', error);
    // In case of error, assume it doesn't exist and proceed with storing
    return false;
  }
};

// 임베딩 가져오기 및 저장
export const getAndStoreEmbeddings = async (indexId: string, videoId: string) => {
  try {
    console.log(`### EMBEDDING: Starting embedding process for video ${videoId} in index ${indexId}`);
    const videoDetails = await fetchVideoDetails(videoId, indexId, true);

    // 디버깅을 위해 전체 videoDetails 구조 로깅
    console.log(`### EMBEDDING - Video details for ${videoId}:`, JSON.stringify({
      _id: videoDetails._id,
      has_system_metadata: Boolean(videoDetails.system_metadata),
      has_embedding: Boolean(videoDetails.embedding),
      embedding_type: videoDetails.embedding ? typeof videoDetails.embedding : 'none'
    }, null, 2));

    // Check specifically if the embedding property exists and is not null/undefined
    if (!videoDetails || !videoDetails.embedding) {
      console.error(`### EMBEDDING ERROR: No embedding data found for video ${videoId}`);
      return { success: false, message: 'No embedding data found' };
    }

    const embedding = videoDetails.embedding;

    // 임베딩 상세 정보 로깅
    console.log(`### EMBEDDING: Got embedding for video ${videoId}:`,
      embedding.video_embedding ?
      `Has ${embedding.video_embedding.segments?.length || 0} segments` :
      'No segments found in embedding');

    if (!embedding.video_embedding || !embedding.video_embedding.segments || embedding.video_embedding.segments.length === 0) {
      console.error(`### EMBEDDING ERROR: Invalid embedding structure for video ${videoId} - missing segments`);
      return { success: false, message: 'Invalid embedding structure - missing segments' };
    }

    // Get both filename and video title
    let filename = videoId;
    let videoTitle = '';

    if (videoDetails.system_metadata) {
      if (videoDetails.system_metadata.filename) {
        filename = videoDetails.system_metadata.filename;
      }
      if (videoDetails.system_metadata.video_title) {
        videoTitle = videoDetails.system_metadata.video_title;
      }
    }

    // 디버깅 로그 추가
    console.log(`### EMBEDDING - Original metadata:`, JSON.stringify({
      original_filename: videoDetails.system_metadata?.filename,
      original_title: videoDetails.system_metadata?.video_title,
      final_filename: filename,
      final_title: videoTitle
    }, null, 2));

    // If no video title is available, use the filename without extension as title
    if (!videoTitle && filename) {
      videoTitle = filename.split('.')[0];
      console.log(`### EMBEDDING - No title found, using filename without extension: "${videoTitle}"`);
    }

    console.log(`### EMBEDDING: Storing embedding for video ${videoId} (title: "${videoTitle}", filename: "${filename}")`);

    // 수정된 embedding 데이터
    const enhancedEmbedding = {
      ...embedding,
      system_metadata: {
        ...(embedding.system_metadata || {}),
        filename,
        video_title: videoTitle
      }
    };

    console.log(`### EMBEDDING - Enhanced metadata:`, JSON.stringify(enhancedEmbedding.system_metadata, null, 2));

    // 2. Store embeddings in Pinecone
    console.log(`### EMBEDDING: Making API request to store embedding for video ${videoId}`);
    const response = await fetch('/api/vectors/store', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId,
        videoName: videoTitle || filename, // Use video title first, fall back to filename
        embedding: enhancedEmbedding,
        indexId: indexId,
      }),
    });

    if (!response.ok) {
      console.error(`### EMBEDDING ERROR: Failed to store embedding for video ${videoId}. Status: ${response.status}`);
      return { success: false, message: 'Failed to store embedding' };
    }

    const result = await response.json();
    console.log(`### EMBEDDING - Store result for ${videoId}:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error(`### EMBEDDING ERROR: Error in getAndStoreEmbeddings for video ${videoId}:`, error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
};

// 사용자 지정 메타데이터 생성
export const generateMetadata = async (videoId: string): Promise<string> => {
  try {
    const response = await fetch(`/api/generate?videoId=${videoId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // Now data has the structure { id, data, usage } where data.data contains the hashtags
    return data.data || '';
  } catch (error) {
    console.error('Error generating metadata:', error);
    throw error;
  }
};

// 파싱된 해시태그에서 메타데이터 객체 생성
export const parseHashtags = (hashtagText: string): Record<string, string> => {

  // 해시태그 문자열에서 메타데이터 추출
  const metadata: Record<string, string> = {
    source: '',
    sector: '',
    emotions: '',
    brands: '',
    locations: '',
    demographics: ''
  };

  // 각 해시태그에서 카테고리 추출 시도
  // 개행문자(\n)를 공백으로 대체하여 일관된 분할 처리
  const cleanText = hashtagText.replace(/\n/g, ' ');
  const hashtags = cleanText.split(/\s+/).filter(tag => tag.startsWith('#'));

  // 각 카테고리별 태그를 수집하기 위한 객체
  const categoryTags: Record<string, string[]> = {
    demographics: [],
    sector: [],
    emotions: [],
    locations: [],
    brands: []
  };

  // 카테고리별 키워드 (모두 소문자로 정의)
  const demographicsKeywords = ['male', 'female', '18-25', '25-34', '35-44', '45-54', '55+'];
  const sectorKeywords = ['beauty', 'fashion', 'tech', 'travel', 'cpg', 'food', 'bev', 'retail'];
  const emotionKeywords = ['happy', 'positive', 'happypositive', 'happy/positive', 'exciting', 'relaxing', 'inspiring', 'serious', 'festive', 'calm', 'determined'];

  // 특정 위치 키워드 - 이것들이 나오면 확실하게 위치로 분류
  const locationKeywords = [
    'seoul', 'dubai', 'doha', 'newyork', 'new york', 'paris', 'tokyo', 'london', 'berlin',
    'lasvegas', 'las vegas', 'france', 'korea', 'qatar', 'uae', 'usa', 'bocachica', 'bocachicabeach', 'marathon'
  ];

  // 특정 브랜드 키워드 - 이것들이 나오면 확실하게 브랜드로 분류
  const brandKeywords = [
    'fentybeauty', 'adidas', 'nike', 'spacex', 'apple', 'microsoft', 'google', 'amazon',
    'ferrari', 'heineken', 'redbullracing', 'redbull', 'sailgp', 'fifaworldcup', 'fifa',
    'tourdefrance', 'nttdata', 'oracle'
  ];

  for (const tag of hashtags) {
    const cleanTag = tag.slice(1).toLowerCase(); // # 제거 및 소문자 변환

    // 인구통계 확인 - 인구통계는 demographics 필드에 저장
    if (demographicsKeywords.includes(cleanTag)) {
      categoryTags.demographics.push(cleanTag);
      continue;
    }

    // 섹터 확인
    if (sectorKeywords.includes(cleanTag)) {
      categoryTags.sector.push(cleanTag);
      continue;
    }

    // 감정 확인
    if (emotionKeywords.includes(cleanTag)) {
      categoryTags.emotions.push(cleanTag);
      continue;
    }

    // 위치 키워드 확인
    if (locationKeywords.includes(cleanTag)) {
      categoryTags.locations.push(cleanTag);
      continue;
    }

    // 브랜드 키워드 확인
    if (brandKeywords.includes(cleanTag)) {
      categoryTags.brands.push(cleanTag);
      continue;
    }
  }

  // 아직 분류되지 않은 태그들 처리
  const unclassifiedTags = hashtags.filter(tag => {
    const cleanTag = tag.slice(1).toLowerCase();
    return !demographicsKeywords.includes(cleanTag) &&
           !sectorKeywords.includes(cleanTag) &&
           !emotionKeywords.includes(cleanTag) &&
           !locationKeywords.includes(cleanTag) &&
           !brandKeywords.includes(cleanTag);
  });

  // 아직 분류되지 않은 태그가 있고, locations가 비어있으면 첫 번째 태그를 locations로 간주
  if (unclassifiedTags.length > 0 && categoryTags.locations.length === 0) {
    categoryTags.locations.push(unclassifiedTags[0].slice(1).toLowerCase());
    unclassifiedTags.shift();
  }

  // 아직 분류되지 않은 태그가 있고, brands가 비어있으면 다음 태그를 brands로 간주
  if (unclassifiedTags.length > 0 && categoryTags.brands.length === 0) {
    categoryTags.brands.push(unclassifiedTags[0].slice(1).toLowerCase());
  }

  // 각 카테고리 태그를 쉼표로 구분된 문자열로 변환
  for (const category in categoryTags) {
    if (categoryTags[category as keyof typeof categoryTags].length > 0) {
      metadata[category] = categoryTags[category as keyof typeof categoryTags].join(', ');
    }
  }

  return metadata;
};

// 메타데이터 업데이트
export const updateVideoMetadata = async (
  videoId: string,
  indexId: string,
  metadata: Record<string, string>
): Promise<boolean> => {
  try {

    const payload = {
      videoId,
      indexId,
      metadata
    };

    const response = await fetch('/api/videos/metadata', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      // 오류가 발생한 경우, 응답 텍스트를 그대로 사용
      console.error('Error updating metadata:', responseText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${responseText}`);
    }

    // 성공 응답이면 JSON으로 파싱 시도, 실패하면 true만 반환
    let success = true;
    if (responseText && responseText.trim() !== '') {
      try {
        const result = JSON.parse(responseText);
        success = result.success !== false; // 명시적으로 false가 아니면 true로 간주
      } catch {
        // 파싱 실패 시 기본값 사용
      }
    }

    return success;
  } catch (error) {
    console.error('Error updating video metadata:', error);
    throw error;
  }
};

// 비디오 메타데이터를 태그로 변환
export const convertMetadataToTags = (metadata: Record<string, unknown>): { category: string; value: string }[] => {
  if (!metadata) return [];

  const tags: { category: string; value: string }[] = [];

  // Source
  if (metadata.source && typeof metadata.source === 'string') {
    tags.push({ category: 'Source', value: metadata.source });
  }

  // Demographics - 새로운 필드로 처리
  if (metadata.demographics && typeof metadata.demographics === 'string') {
    // 쉼표로 구분된 값을 개별 태그로 추가
    metadata.demographics.split(',').map(tag => tag.trim()).filter(tag => tag !== '').forEach(tag => {
      tags.push({ category: 'Demographics', value: tag });
    });
  }

  // Sector
  if (metadata.sector && typeof metadata.sector === 'string') {
    // 쉼표로 구분된 값을 개별 태그로 추가
    metadata.sector.split(',').map(tag => tag.trim()).filter(tag => tag !== '').forEach(tag => {
      tags.push({ category: 'Sector', value: tag });
    });
  }

  // Emotions
  if (metadata.emotions && typeof metadata.emotions === 'string') {
    // 쉼표로 구분된 값을 개별 태그로 추가
    metadata.emotions.split(',').map(tag => tag.trim()).filter(tag => tag !== '').forEach(tag => {
      tags.push({ category: 'Emotions', value: tag });
    });
  }

  // Brands
  if (metadata.brands && typeof metadata.brands === 'string') {
    // 쉼표로 구분된 값을 개별 태그로 추가
    metadata.brands.split(',').map(tag => tag.trim()).filter(tag => tag !== '').forEach(tag => {
      tags.push({ category: 'Brands', value: tag });
    });
  }

  // Locations
  if (metadata.locations && typeof metadata.locations === 'string') {
    // 쉼표로 구분된 값을 개별 태그로 추가
    metadata.locations.split(',').map(tag => tag.trim()).filter(tag => tag !== '').forEach(tag => {
      tags.push({ category: 'Location', value: tag });
    });
  }

  return tags;
};

// 텍스트 검색 결과 타입 정의
interface SearchPageInfo {
  page: number;
  total_page: number;
  total_videos: number;
  total_results?: number;
  limit_per_page?: number;
  next_page_token?: string;
  prev_page_token?: string;
  page_expires_at?: string;
}

interface SearchResult {
  _id: string;
  index_id: string;
  video_id: string;
  score: number;
  duration: number;
  thumbnail_url?: string;
  video_url?: string;
  video_title?: string;
  segments?: Array<{
    start: number;
    end: number;
    score: number;
    matched_words?: string[];
  }>;
}

// 텍스트 검색 수행
export const searchVideos = async (
  searchQuery: string,
  indexId?: string
): Promise<{ pageInfo: SearchPageInfo; textSearchResults: SearchResult[] }> => {
  try {
    console.log('🔍 > searchVideos > Searching for:', searchQuery);

    if (!searchQuery || searchQuery.trim() === '') {
      return {
        pageInfo: { page: 1, total_page: 1, total_videos: 0, total_results: 0 },
        textSearchResults: []
      };
    }

    // Use provided indexId or get from environment - renamed variable to avoid confusion
    const searchIndexId = indexId || process.env.NEXT_PUBLIC_CONTENT_INDEX_ID;
    console.log('🔍 > searchVideos > Using index ID:', searchIndexId,
                'Is ads index?', searchIndexId === process.env.NEXT_PUBLIC_ADS_INDEX_ID,
                'Is content index?', searchIndexId === process.env.NEXT_PUBLIC_CONTENT_INDEX_ID);

    // Make an initial search request to get the correct total count
    // Use a larger page_size to increase chance of getting full count in first request
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textSearchQuery: searchQuery,
        indexId: searchIndexId,
        page_size: 100  // Request larger page size to get complete results if possible
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('🔍 > searchVideos > Raw API response:', JSON.stringify(data));
    console.log('🔍 > searchVideos > API response pageInfo:', data.pageInfo);
    console.log('🔍 > searchVideos > ResultCount from API:', data.textSearchResults?.length || 0);
    console.log('🔍 > searchVideos > total_results from API:', data.pageInfo?.total_results);

    // If we need to limit the results to display, only pass back first 10
    const limitedResults = data.textSearchResults?.slice(0, 10) || [];

    // Return results with correct total_results count but limited initial results
    return {
      pageInfo: {
        ...data.pageInfo,
        // Ensure total_results is preserved from the original response
        total_results: data.pageInfo?.total_results || limitedResults.length,
      },
      textSearchResults: limitedResults
    };
  } catch (error) {
    console.error('Error searching videos:', error);
    throw error;
  }
};

// Get embedding from TwelveLabs API
export const getVideoEmbedding = async (
  videoId: string,
  indexId: string
): Promise<EmbeddingResponse> => {
  try {
    const response = await fetch('/api/vectors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ video_id: videoId, index_id: indexId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting video embedding:', error);
    throw error;
  }
};

// Reset Pinecone vectors
export const resetPineconeVectors = async (
  videoId?: string,
  indexId?: string,
  resetAll: boolean = false
): Promise<boolean> => {
  try {
    console.log(`Resetting vectors: videoId=${videoId || 'none'}, indexId=${indexId || 'none'}, resetAll=${resetAll}`);

    const response = await fetch('/api/vectors/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId,
        indexId,
        resetAll
      }),
    });

    if (!response.ok) {
      console.error(`Failed to reset vectors. Status: ${response.status}`);
      return false;
    }

    const data = await response.json();
    console.log('Reset response:', data);
    return data.success === true;
  } catch (error) {
    console.error('Error resetting vectors:', error);
    return false;
  }
};