export type IndexResponse = {
    _id: string;
    index_name: string;
    created_at: string;
    updated_at: string;
    addons: string[];
    models: [
      {
        model_name: string;
        model_options: string[];
        finetuned: false
      },
      {
        model_name: 'pegasus1.2',
        model_options: string[];
        finetuned: boolean;
      }
    ],
    video_count: number;
    total_duration: number;
  }


// Tag type for content metadata
export type Tag = {
  category: string;
  value: string;
};

// Content item type
export type ContentItem = {
  id: string;
  thumbnailUrl: string;
  title: string;
  videoUrl: string;
  tags: Tag[];
  metadata?: {
    source?: string;
    topic_category?: string;
    emotions?: string;
    brands?: string;
    locations?: string;
    demo_age?: string;
    demo_gender?: string;
  };
};

// API 관련 타입
export type VideoData = {
  _id: string;
  index_id?: string;
  created_at?: string;
  updated_at?: string;
  user_metadata?: {
    source?: string;
    topic_category?: string;
    sector?: string; // Keep for backward compatibility
    emotions?: string;
    brands?: string;
    locations?: string;
    demo_age?: string;
    demo_gender?: string;
    demographics?: string; // Keep for backward compatibility
    [key: string]: string | undefined;
  };
  system_metadata?: {
    filename?: string;
    video_title?: string;
    duration?: number;
    fps?: number;
    height?: number;
    width?: number;
    size?: number;
    audio_channel?: number;
    audio_length_ns?: number;
    audio_sample_rate?: number;
    audio_stream_id?: string;
    audio_stream_idx?: number;
    video_length_ns?: number;
    video_stream_id?: string;
    video_stream_idx?: number;
    engine_ids?: string[];
    model_names?: string[];
    created_at?: string;
    title?: string;
    url?: string;
    thumbnail_url?: string;
  };
  hls?: {
    video_url?: string;
    thumbnail_urls?: string[];
    status?: string;
    updated_at?: string;
  };
  metadata?: {
    tags?: Tag[];
    title?: string;
    url?: string;
    thumbnailUrl?: string;
  };
};

export interface VideoPage {
  data: VideoData[];
  page_info: {
    limit_per_page: number;
    page: number;
    total_duration: number;
    total_page: number;
    total_results: number;
  };
}

export type PageInfo = {
  page: number;
  total_page: number;
  total_count: number;
};

export type PaginatedResponse = {
  data: VideoData[];
  page_info: PageInfo;
};

export type ApiError = {
  message: string;
  status?: number;
};

// Video 컴포넌트 타입
export type VideoProps = {
  videoId: string;
  indexId: string;
  showTitle?: boolean;
  videoDetails?: VideoDetails;
  playing?: boolean;
  onPlay?: () => void;
};

export interface VideosDropDownProps {
  indexId: string;
  onVideoChange: (footageVideoId: string) => void;
  videosData: {
    pages: VideoPage[];
    pageParams: number[];
  };
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  selectedFile: File | null;
  taskId: string | null;
  footageVideoId: string | null;
}

export type VideoDetails = {
  _id: string;
  hls?: {
    video_url?: string;
    thumbnail_urls?: string[];
  };
  system_metadata?: {
    filename?: string;
    duration?: number;
    video_title?: string;
    fps?: number;
    height?: number;
    width?: number;
  };
};

export interface Segment {
  embedding_scope: string;
  end_offset_sec: number;
  float: number[];
  start_offset_sec: number;
}

export interface Vector {
  id: string;
  values: number[];
  metadata: VectorMetadata;
}

export interface VectorMetadata {
  category: string;
  end_time: number;
  scope: string;
  start_time: number;
  tl_index_id: string;
  tl_video_id: string;
  video_file: string;
  video_segment: number;
}

// Define types for embeddings and transcription
export interface EmbeddingSegment {
  embedding_option: string;
  embedding_scope: string;
  end_offset_sec: number;
  float: number[];
  start_offset_sec: number;
}

export interface VideoEmbedding {
  segments: EmbeddingSegment[];
}

export interface Embedding {
  model_name: string;
  video_embedding: VideoEmbedding;
}

export interface EmbeddingResponse {
  videoId: string;
  exists: boolean;
  embedding: Embedding;
}

export interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: Size;
  color?: Color;
}

export type Size = 'sm' | 'md' | 'lg';
export type Color = 'default' | 'primary';

// 챕터 데이터용 타입
export interface ChapterData {
  start: number;
  end: number;
  text: string;
}

export interface ChaptersResponse {
  chapters: ChapterData[];
  type: string;
  video_id: string;
}

export interface AdItemType {
  id: string;
  thumbnailUrl: string;
  title: string;
  videoUrl: string;
  tags: Tag[];
  metadata?: {
    source?: string;
    topic_category?: string;
    emotions?: string;
    brands?: string;
    locations?: string;
    demo_age?: string;
    demo_gender?: string;
  };
  isIndexing?: boolean;
  indexingStatus?: string;
  taskId?: string;
  status?: string;
}

export interface FilterMenuProps {
  showFilterMenu: boolean;
  selectedFilterCategory: string | null;
  filterCategories: FilterCategory[];
  filterOptions: {[key: string]: string[]};
  onFilterCategorySelect: (categoryId: string | null) => void;
  onToggleFilter: (category: string, value: string) => void;
  onResetCategoryFilters: (category: string) => void;
  onCloseFilterMenu: () => void;
  getActiveCategoryFilterCount: (category: string) => number;
  isFilterActive: (category: string, value: string) => boolean;
  capitalizeText: (text: string) => string;
}
export interface ActiveFiltersProps {
  activeFilters: {[key: string]: string[]};
  onResetCategoryFilters: (category: string) => void;
  onResetAllFilters: () => void;
  getTotalActiveFilterCount: () => number;
  capitalizeText: (text: string) => string;
}

type FilterCategory = {
  id: string;
  label: string;
};

export interface SearchResult {
  _id: string;
  index_id?: string;
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
  [key: string]: string | number | boolean | object | undefined;
}