"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useInfiniteQuery, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import Sidebar from '@/components/Sidebar';
import SearchBar from '@/components/SearchBar';
import ActionButtons from '@/components/ActionButtons';
// FilterTabs는 지금 사용하지 않으므로 주석 처리
// import FilterTabs from '@/components/FilterTabs';
import ContentItem from '@/components/ContentItem';
import SearchResults from '@/components/SearchResults';
import VideoUploader from '@/components/VideoUploader';
// 타입 충돌을 해결하기 위해 로컬 타입 정의만 사용
// import { ContentItem as AdItemType, VideoData, Tag } from '@/types';
import {
  fetchVideos,
  fetchIndex,
  generateMetadata,
  parseHashtags,
  updateVideoMetadata,
  convertMetadataToTags,
  fetchVideoDetails,
  fetchIndexingTasks,
  IndexingTask
} from '@/hooks/apiHooks';
import LoadingSpinner from '../../components/LoadingSpinner';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't cache queries to ensure we always get fresh data
      staleTime: 0,
      // Disable retry on failure
      retry: false,
    },
  },
});

// Content Index ID from .env
const adsIndexId = process.env.NEXT_PUBLIC_ADS_INDEX_ID || 'default-ads-index';

// Column definitions
const COLUMNS = [
  { id: 'video', label: 'Video', width: '320px' },
  { id: 'topic_category', label: 'Topic Category', width: '130px' },
  { id: 'emotions', label: 'Emotions', width: '130px' },
  { id: 'brands', label: 'Brands', width: '130px' },
  { id: 'demo_gender', label: 'Target Demo:\nGender', width: '130px' },
  { id: 'demo_age', label: 'Target Demo:\nAge', width: '130px' },
  { id: 'location', label: 'Location', width: '130px' },
  { id: 'source', label: 'Source', width: '300px' },
];

// Limit for concurrent metadata processing
const CONCURRENCY_LIMIT = 10;

// 타입 정의
interface Tag {
  category: string;
  value: string;
}

interface AdItemType {
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

interface VideoData {
  _id: string;
  hls?: {
    thumbnail_urls?: string[];
    video_url?: string;
  };
  system_metadata?: {
    video_title?: string;
    filename?: string;
  };
  user_metadata?: Record<string, unknown>;
  metadata?: {
    tags?: Tag[];
  };
}

export default function AdsLibrary() {
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // activeTab은 현재 사용하지 않으므로 주석 처리
  // const [activeTab, setActiveTab] = useState('Video');
  const [processingMetadata, setProcessingMetadata] = useState(false);
  const [videosInProcessing, setVideosInProcessing] = useState<string[]>([]);
  const [adItems, setAdItems] = useState<AdItemType[]>([]);
  const [skipMetadataProcessing, setSkipMetadataProcessing] = useState(false);
  // Keep track of videos we've already processed to avoid duplicates
  const [processedVideoIds, setProcessedVideoIds] = useState<Set<string>>(new Set());
  // State for filter menu
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string | null>(null);
  // State for video uploader
  const [showUploader, setShowUploader] = useState(false);
  const [recentUploads, setRecentUploads] = useState<{
    id: string;
    taskId: string;
    title: string;
    status: string;
    thumbnailUrl?: string;
    duration?: string;
  }[]>([]);

  const { data: indexData, refetch: refetchIndex } = useQuery({
    queryKey: ['index', adsIndexId],
    queryFn: () => fetchIndex(adsIndexId),
    staleTime: 0, // Always get fresh data
    refetchInterval: 5000, // Refetch every 5 seconds to keep count updated
  });

  // Filter states
  const [filterOptions, setFilterOptions] = useState<{[key: string]: string[]}>({
    topic_category: [],
    emotions: [],
    brands: [],
    demo_age: [],
    demo_gender: [],
    location: []
  });
  const [activeFilters, setActiveFilters] = useState<{[key: string]: string[]}>({
    topic_category: [],
    emotions: [],
    brands: [],
    demo_age: [],
    demo_gender: [],
    location: []
  });
  const [filteredItems, setFilteredItems] = useState<AdItemType[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);

  // Filter categories
  const filterCategories = [
    { id: 'topic_category', label: 'Topic Category' },
    { id: 'emotions', label: 'Emotions' },
    { id: 'brands', label: 'Brands' },
    { id: 'demo_age', label: 'Target Demo: Age' },
    { id: 'demo_gender', label: 'Target Demo: Gender' },
    { id: 'location', label: 'Location' },
  ];

  // Fetch videos from API
  const {
    data: videosData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch
  } = useInfiniteQuery({
    queryKey: ['videos', adsIndexId],
    queryFn: ({ pageParam }) => fetchVideos(pageParam, adsIndexId),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.page_info.page < lastPage.page_info.total_page) {
        return lastPage.page_info.page + 1;
      }
      return undefined;
    },
    enabled: !!adsIndexId,
  });

  // Convert API response to AdItemType
  const convertToAdItem = (video: VideoData): AdItemType => {
    let tags: Tag[] = [];

    // Check if the video is still indexing by comparing with recentUploads
    const indexingVideo = recentUploads.find(uploadingVideo =>
      uploadingVideo.id === video._id && uploadingVideo.status !== 'ready'
    );
    const isStillIndexing = !!indexingVideo;

    // Only generate tags if the video is not still indexing
    if (isStillIndexing) {
      console.log(`Video ${video._id} is still indexing, skipping tag generation`);
      tags = [];
    }
    // Use existing tags if available
    else if (video.metadata?.tags) {
      tags = video.metadata.tags;
    }
    // Convert user metadata to tags if available
    else if (video.user_metadata) {
      console.log(`Converting metadata for video ${video._id}:`, video.user_metadata);
      tags = convertMetadataToTags(video.user_metadata);
    }

    // 데이터 타입에 맞게 메타데이터를 추출합니다
    // 인덱싱 중이면 메타데이터를 생성하지 않음
    const metadata = (!isStillIndexing && video.user_metadata) ? {
      source: video.user_metadata.source as string,
      topic_category: video.user_metadata.sector as string,
      emotions: video.user_metadata.emotions as string,
      brands: video.user_metadata.brands as string,
      locations: video.user_metadata.locations as string,
      demo_age: video.user_metadata.demographics ?
                (video.user_metadata.demographics as string).split(',')
                .filter(d => d.toLowerCase().includes('age') ||
                            d.toLowerCase().includes('old') ||
                            /\d+-\d+/.test(d)).join(', ') : '',
      demo_gender: video.user_metadata.demographics ?
                  (video.user_metadata.demographics as string).split(',')
                  .filter(d => d.toLowerCase().includes('male') ||
                              d.toLowerCase().includes('women') ||
                              d.toLowerCase().includes('men')).join(', ') : '',
    } : undefined;

    // 메타데이터 상태를 보존하기 위해 로그 추가
    if (metadata) {
      console.log(`Video ${video._id} metadata converted:`, metadata);
    }

    return {
      id: video._id,
      thumbnailUrl: video.hls?.thumbnail_urls?.[0] || 'https://placehold.co/600x400',
      title: video.system_metadata?.video_title || video.system_metadata?.filename || 'Untitled Video',
      videoUrl: video.hls?.video_url || '',
      tags: tags,
      metadata: metadata,
      isIndexing: isStillIndexing,
      status: isStillIndexing ? (indexingVideo?.status || 'processing') : undefined
    };
  };

  // Function to refresh metadata for a specific video
  const refreshVideoMetadata = useCallback(async (videoId: string) => {
    if (!adsIndexId) return;

    console.log(`Refreshing metadata for video ${videoId}`);
    try {
      // Fetch fresh video details from API
      const updatedVideo = await fetchVideoDetails(videoId, adsIndexId);

      if (updatedVideo) {
        console.log(`Received updated video data for ${videoId}:`, updatedVideo);

        // Update content items with fresh data
        setAdItems(prevItems => {
          return prevItems.map(item => {
            if (item.id === videoId) {
              // Create a proper metadata object from user_metadata
              const updatedMetadata = updatedVideo.user_metadata ? {
                source: updatedVideo.user_metadata.source || '',
                topic_category: updatedVideo.user_metadata.sector || '',  // 중요: sector를 topic_category로 매핑
                emotions: updatedVideo.user_metadata.emotions || '',
                brands: updatedVideo.user_metadata.brands || '',
                locations: updatedVideo.user_metadata.locations || '',
                demo_age: updatedVideo.user_metadata.demographics ?
                  (updatedVideo.user_metadata.demographics as string).split(',')
                  .filter(d => d.toLowerCase().includes('age') ||
                    d.toLowerCase().includes('old') ||
                    /\d+-\d+/.test(d)).join(', ') : '',
                demo_gender: updatedVideo.user_metadata.demographics ?
                  (updatedVideo.user_metadata.demographics as string).split(',')
                  .filter(d => d.toLowerCase().includes('male') ||
                    d.toLowerCase().includes('women') ||
                    d.toLowerCase().includes('men')).join(', ') : '',
              } : undefined;

              // 태그도 올바르게 업데이트
              const updatedTags = updatedVideo.user_metadata ? convertMetadataToTags(updatedVideo.user_metadata) : [];

              // 새 아이템 생성
              const updatedItem = {
                ...item,
                tags: updatedTags,
                metadata: updatedMetadata
              };

              console.log(`Updated ads item for ${videoId}:`, updatedItem);
              return updatedItem;
            }
            return item;
          });
        });
      }
    } catch (error) {
      console.error(`Error refreshing metadata for video ${videoId}:`, error);
      // If direct update fails, use refetch as a fallback
      if (refetch) {
        console.log("Direct metadata refresh failed, falling back to full refetch");
        refetch();
      }
    }
  }, [adsIndexId, refetch]);

  // Process metadata for a single video
  const processVideoMetadataSingle = useCallback(async (video: VideoData): Promise<boolean> => {
    if (!adsIndexId) return false;

    const videoId = video._id;

    // Skip if already processed or currently processing
    if (processedVideoIds.has(videoId) || videosInProcessing.includes(videoId)) {
      console.log(`Video ${videoId} already processed or processing, skipping...`);
      return false;
    }

    try {
      // 1. Only process if metadata is missing - stricter check
      if (!video.user_metadata ||
          Object.keys(video.user_metadata).length === 0 ||
          (!video.user_metadata.source && !video.user_metadata.topic_category &&
           !video.user_metadata.emotions && !video.user_metadata.brands &&
           !video.user_metadata.locations)) {

        // 2. Generate metadata
        console.log(`Generating metadata for video ${videoId}`);
        setVideosInProcessing(prev => [...prev, videoId]);

        const hashtagText = await generateMetadata(videoId);

        if (hashtagText) {
          // 3. Parse hashtags to create metadata object
          const metadata = parseHashtags(hashtagText);

          // 4. Save metadata and immediately update UI
          console.log(`Updating metadata for video ${videoId}`, metadata);
          await updateVideoMetadata(videoId, adsIndexId, metadata);

          // 5. Update this specific video in the UI without waiting for a full refresh
          setAdItems(prevItems => {
            return prevItems.map(item => {
              if (item.id === videoId) {
                return {
                  ...item,
                  metadata: metadata,
                  tags: convertMetadataToTags(metadata),
                  status: item.isIndexing ? item.status : undefined
                };
              }
              return item;
            });
          });

          // Add to processed videos set
          setProcessedVideoIds(prev => new Set(prev).add(videoId));
          setVideosInProcessing(prev => prev.filter(id => id !== videoId));
          return true;
        }

        setVideosInProcessing(prev => prev.filter(id => id !== videoId));
      } else {
        console.log(`Video ${videoId} already has metadata, skipping...`);
        // Still mark as processed to avoid checking again
        setProcessedVideoIds(prev => new Set(prev).add(videoId));
      }
      return false;
    } catch (error) {
      console.error(`Error processing metadata for video ${videoId}:`, error);
      setVideosInProcessing(prev => prev.filter(id => id !== videoId));
      return false;
    }
  }, [adsIndexId, processedVideoIds, videosInProcessing]);

  // Function to filter videos that need metadata processing
  const filterVideosNeedingMetadata = (videos: VideoData[], processedIds: Set<string>, inProcessingIds: string[]) => {
    return videos.filter(video =>
      !processedIds.has(video._id) &&
      !inProcessingIds.includes(video._id) &&
      (!video.user_metadata ||
      Object.keys(video.user_metadata).length === 0 ||
      (!video.user_metadata.source &&
       !video.user_metadata.topic_category &&
       !video.user_metadata.emotions &&
       !video.user_metadata.brands &&
       !video.user_metadata.locations))
    );
  };

  // Batch process video metadata with concurrency control
  const processVideoMetadata = useCallback(async (videos: VideoData[]) => {
    if (!adsIndexId || videos.length === 0 || skipMetadataProcessing) return;

    // Filter videos that need metadata
    // 중요: 인덱싱 중인 비디오는 메타데이터 처리를 건너뜁니다
    const videosNeedingMetadata = videos.filter(video => {
      // 1. 이미 처리 중이거나 처리 완료된 비디오는 건너뜁니다
      if (processedVideoIds.has(video._id) || videosInProcessing.includes(video._id)) {
        return false;
      }

      // 2. 현재 인덱싱 중인 비디오는 건너뜁니다
      const isStillIndexing = recentUploads.some(uploadingVideo =>
        uploadingVideo.id === video._id && uploadingVideo.status !== 'ready'
      );
      if (isStillIndexing) {
        console.log(`Video ${video._id} is still indexing, skipping metadata generation`);
        return false;
      }

      // 3. 메타데이터가 없는 비디오만 처리합니다
      return (!video.user_metadata ||
        Object.keys(video.user_metadata).length === 0 ||
        (!video.user_metadata.source &&
         !video.user_metadata.topic_category &&
         !video.user_metadata.emotions &&
         !video.user_metadata.brands &&
         !video.user_metadata.locations));
    });

    if (videosNeedingMetadata.length === 0) {
      console.log('No videos need metadata processing');
      return;
    }

    console.log(`Processing metadata for ${videosNeedingMetadata.length} videos`);
    setProcessingMetadata(true);
    // Temporarily disable metadata processing to prevent recursive processing
    setSkipMetadataProcessing(true);

    try {
      // Function for concurrency control
      const processBatch = async (batch: VideoData[]) => {
        const results = await Promise.all(
          batch.map(async (video) => {
            const result = await processVideoMetadataSingle(video);
            return result;
          })
        );

        return results.some(result => result);
      };

      // Process videos in batches
      for (let i = 0; i < videosNeedingMetadata.length; i += CONCURRENCY_LIMIT) {
        const batch = videosNeedingMetadata.slice(i, i + CONCURRENCY_LIMIT);
        await processBatch(batch);
      }

      // No need to refetch here since we update the UI immediately in processVideoMetadataSingle
      console.log('All metadata processing completed');
    } catch (error) {
      console.error("Error processing video metadata:", error);
    } finally {
      setProcessingMetadata(false);
      setVideosInProcessing([]);
      // Re-enable metadata processing after completion
      setTimeout(() => setSkipMetadataProcessing(false), 2000);
    }
  }, [adsIndexId, processVideoMetadataSingle, skipMetadataProcessing, processedVideoIds, videosInProcessing, recentUploads]);

  // Update ContentItems array whenever video data changes
  useEffect(() => {
    if (videosData) {
      console.log('Processing video data update:', videosData.pages.length, 'pages');

      // 1. 현재 상태의 adItems를 유지하면서 새 비디오 데이터를 통합합니다
      setAdItems(prevItems => {
        // 기존 아이템의 ID 맵을 생성하여 빠르게 조회할 수 있게 합니다
        const existingItemsMap = new Map(
          prevItems.map(item => [item.id, item])
        );

        // 모든 페이지에서 비디오 데이터를 처리합니다
        const updatedItems = videosData.pages.flatMap(page =>
          page.data.map(video => {
            const videoId = video._id;
            const existingItem = existingItemsMap.get(videoId);

            // 이미 존재하는 아이템이 있고 메타데이터가 있으면 그것을 유지합니다
            if (existingItem && (
              (existingItem.metadata && Object.keys(existingItem.metadata).length > 0) ||
              (existingItem.tags && existingItem.tags.length > 0)
            )) {
              console.log(`Preserving existing metadata for video ${videoId}`);
              return existingItem;
            }

            // 그렇지 않으면 새 컨텐츠 아이템을 생성합니다
            const newItem = convertToAdItem(video);
            console.log(`Video ${video._id} converted:`, {
              hasMetadata: !!video.user_metadata,
              metadataKeys: video.user_metadata ? Object.keys(video.user_metadata) : [],
              tagsCount: newItem.tags.length
            });
            return newItem;
          })
        );

        console.log(`Updated ads items: ${updatedItems.length} items, ${prevItems.length} were existing`);
        return updatedItems;
      });

      // 2. 배경에서 메타데이터 처리를 시작하고 준비가 되면 아이템을 업데이트
      if (videosData.pages.length > 0 && !processingMetadata && !skipMetadataProcessing) {
        // 새로 로드된 모든 비디오에 대해 메타데이터 처리를 지연시킵니다
        setTimeout(() => {
          const allVideos = videosData.pages.flatMap(page => page.data);
          const newlyLoadedVideos = filterVideosNeedingMetadata(allVideos, processedVideoIds, videosInProcessing);

          if (newlyLoadedVideos.length > 0) {
            console.log(`Processing metadata for ${newlyLoadedVideos.length} newly loaded videos`);
            processVideoMetadata(newlyLoadedVideos);
          }
        }, 100); // 짧은 시간 지연으로 비디오 렌더링이 우선 처리되도록 함
      }
    }
  }, [videosData, processingMetadata, processVideoMetadata, skipMetadataProcessing, processedVideoIds, videosInProcessing]);

  // Extract unique filter options from ads items
  useEffect(() => {
    if (adItems.length > 0) {
      // Use a Map instead of Set to track both lowercase and display versions
      // The key is the lowercase version (for uniqueness) and the value is the display version
      const options: {[key: string]: Map<string, string>} = {
        topic_category: new Map<string, string>(),
        emotions: new Map<string, string>(),
        brands: new Map<string, string>(),
        demo_age: new Map<string, string>(),
        demo_gender: new Map<string, string>(),
        location: new Map<string, string>()
      };

      adItems.forEach(item => {
        if (item.metadata) {
          // Extract topic_category
          if (item.metadata.topic_category) {
            const topics = item.metadata.topic_category.split(',').map(s => s.trim());
            topics.forEach(topic => {
              if (topic) {
                // Use lowercase as key for uniqueness, but store display version
                const lowercaseTopic = topic.toLowerCase();
                // Prefer capitalized version if we haven't seen this value before,
                // otherwise keep the existing display version
                if (!options.topic_category.has(lowercaseTopic)) {
                  options.topic_category.set(lowercaseTopic, capitalizeText(topic));
                }
              }
            });
          }

          // Extract emotions
          if (item.metadata.emotions) {
            const emotions = item.metadata.emotions.split(',').map(e => e.trim());
            emotions.forEach(emotion => {
              if (emotion) {
                const lowercaseEmotion = emotion.toLowerCase();
                if (!options.emotions.has(lowercaseEmotion)) {
                  options.emotions.set(lowercaseEmotion, capitalizeText(emotion));
                }
              }
            });
          }

          // Extract brands
          if (item.metadata.brands) {
            const brands = item.metadata.brands.split(',').map(b => b.trim());
            brands.forEach(brand => {
              if (brand) {
                const lowercaseBrand = brand.toLowerCase();
                if (!options.brands.has(lowercaseBrand)) {
                  options.brands.set(lowercaseBrand, capitalizeText(brand));
                }
              }
            });
          }

          // Extract demo_age
          if (item.metadata.demo_age) {
            const ages = item.metadata.demo_age.split(',').map(a => a.trim());
            ages.forEach(age => {
              if (age) {
                const lowercaseAge = age.toLowerCase();
                if (!options.demo_age.has(lowercaseAge)) {
                  options.demo_age.set(lowercaseAge, capitalizeText(age));
                }
              }
            });
          }

          // Extract demo_gender
          if (item.metadata.demo_gender) {
            const genders = item.metadata.demo_gender.split(',').map(g => g.trim());
            genders.forEach(gender => {
              if (gender) {
                const lowercaseGender = gender.toLowerCase();
                if (!options.demo_gender.has(lowercaseGender)) {
                  options.demo_gender.set(lowercaseGender, capitalizeText(gender));
                }
              }
            });
          }

          // Extract locations
          if (item.metadata.locations) {
            const locations = item.metadata.locations.split(',').map(l => l.trim());
            locations.forEach(location => {
              if (location) {
                const lowercaseLocation = location.toLowerCase();
                if (!options.location.has(lowercaseLocation)) {
                  options.location.set(lowercaseLocation, capitalizeText(location));
                }
              }
            });
          }
        }
      });

      // Convert Maps to arrays (only the display values) and sort alphabetically
      // Also prioritize shorter options within the same alphabetical first letter
      const sortOptions = (a: string, b: string) => {
        // First sort by first letter
        if (a[0].toLowerCase() !== b[0].toLowerCase()) {
          return a.localeCompare(b);
        }
        // Then sort by length
        return a.length - b.length;
      };

      setFilterOptions({
        topic_category: Array.from(options.topic_category.values()).sort(sortOptions),
        emotions: Array.from(options.emotions.values()).sort(sortOptions),
        brands: Array.from(options.brands.values()).sort(sortOptions),
        demo_age: Array.from(options.demo_age.values()).sort(sortOptions),
        demo_gender: Array.from(options.demo_gender.values()).sort(sortOptions),
        location: Array.from(options.location.values()).sort(sortOptions)
      });
    }
  }, [adItems]);

  // Apply filters to ads items
  useEffect(() => {
    const hasActiveFilters = Object.values(activeFilters).some(filters => filters.length > 0);
    setIsFiltering(hasActiveFilters);

    if (!hasActiveFilters) {
      setFilteredItems(adItems);
      return;
    }

    console.log('Active filters:', activeFilters);

    const filtered = adItems.filter(item => {
      // Check if the item matches all active filters
      return Object.entries(activeFilters).every(([category, filters]) => {
        // If no filters are active for this category, it's a match
        if (filters.length === 0) return true;

        // Get the metadata value for this category
        let metadataValue = '';
        switch (category) {
          case 'topic_category':
            metadataValue = item.metadata?.topic_category || '';
            break;
          case 'emotions':
            metadataValue = item.metadata?.emotions || '';
            break;
          case 'brands':
            metadataValue = item.metadata?.brands || '';
            break;
          case 'demo_age':
            metadataValue = item.metadata?.demo_age || '';
            break;
          case 'demo_gender':
            metadataValue = item.metadata?.demo_gender || '';
            break;
          case 'location':
            metadataValue = item.metadata?.locations || '';
            break;
        }

        // If the metadata value is empty and filters are active for this category,
        // this item doesn't match the filter criteria
        if (metadataValue === '' && filters.length > 0) {
          console.log(`Filtering out item ${item.id} because ${category} is empty and filters are active:`, filters);
          return false;
        }

        // Split the metadata value by comma and trim
        const values = metadataValue.split(',').map(v => v.trim());

        // Debug log for this specific category and its values
        if (filters.length > 0) {
          console.log(`Checking ${category}:`, {
            filterValues: filters,
            itemValues: values
          });
        }

        // Check if any of the item's values match any of the active filters
        return filters.some(filter =>
          values.some(value => {
            // Do case-insensitive comparison
            const normalizedValue = value.toLowerCase();
            const normalizedFilter = filter.toLowerCase();

            // Check for exact match (case insensitive)
            if (normalizedValue === normalizedFilter) {
              console.log(`Match found for ${category}: '${value}' === '${filter}' (case insensitive)`);
              return true;
            }

            // Check for word boundary matches (e.g., "travel" as a separate word in "travel and tourism")
            // This prevents e.g. "Travel" from matching in "Traveling" but allows it in "Travel and Tourism"
            const valueWords = normalizedValue.split(/\s+|,|\/|\&/);
            const filterWords = normalizedFilter.split(/\s+|,|\/|\&/);

            const wordMatch = filterWords.some(filterWord =>
              valueWords.some(valueWord => valueWord === filterWord)
            );

            if (wordMatch) {
              console.log(`Word match found for ${category}: '${normalizedValue}' contains word from '${normalizedFilter}'`);
              return true;
            }

            return false;
          })
        );
      });
    });

    setFilteredItems(filtered);
  }, [activeFilters, adItems]);

  // Toggle filter selection
  const toggleFilter = (category: string, value: string) => {
    console.log(`Toggling filter: ${category} = ${value}`);
    setActiveFilters(prev => {
      const current = [...prev[category]];

      // Toggle the filter
      if (current.includes(value)) {
        return {
          ...prev,
          [category]: current.filter(v => v !== value)
        };
      } else {
        return {
          ...prev,
          [category]: [...current, value]
        };
      }
    });
  };

  // Reset filters for a specific category
  const resetCategoryFilters = (category: string) => {
    setActiveFilters(prev => ({
      ...prev,
      [category]: []
    }));
  };

  // Reset all filters
  const resetAllFilters = () => {
    setActiveFilters({
      topic_category: [],
      emotions: [],
      brands: [],
      demo_age: [],
      demo_gender: [],
      location: []
    });
    setShowFilterMenu(false);
    setSelectedFilterCategory(null);
  };

  // Helper function to properly capitalize text
  const capitalizeText = (text: string): string => {
    return text
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Check if a filter is active
  const isFilterActive = (category: string, value: string) => {
    return activeFilters[category].includes(value);
  };

  // Get active filter count for a category
  const getActiveCategoryFilterCount = (category: string) => {
    return activeFilters[category].length;
  };

  // Get total active filter count
  const getTotalActiveFilterCount = () => {
    return Object.values(activeFilters).reduce((total, filters) => total + filters.length, 0);
  };

  // Search handler
  const handleSearch = (query: string) => {
    if (query.trim() !== '') {
      setSearchQuery(query);
      setSearchSubmitted(true);
    } else {
      setSearchSubmitted(false);
    }
  };

  // Clear search handler
  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchSubmitted(false);
  };

  const handleUpload = () => {
    console.log('Upload clicked');
    setShowUploader(true);
  };

  const handleUploadComplete = () => {
    // Refresh video list after upload is complete
    console.log('Upload complete, refreshing videos');
    fetchRecentTasks(); // Fetch the recently uploaded videos' status

    if (refetch) {
      refetch();
    }
    // Close the uploader
    setShowUploader(false);
  };

  const handleFilter = () => {
    console.log('Filter clicked');
    setShowFilterMenu(!showFilterMenu);
    setSelectedFilterCategory(null);
  };

  const handleFilterCategorySelect = (categoryId: string) => {
    setSelectedFilterCategory(categoryId);
  };

  // Close filter menu
  const closeFilterMenu = () => {
    setShowFilterMenu(false);
    setSelectedFilterCategory(null);
  };

  // 무한 스크롤을 위한 Intersection Observer 설정
  const { ref: observerRef, inView } = useInView({
    threshold: 0.1,
    triggerOnce: false,
  });

  // 화면에 관찰 요소가 보일 때 다음 페이지 로드
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage && !isFiltering) {
      console.log('무한 스크롤: 다음 페이지 로드');
      setSkipMetadataProcessing(false);
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, isFiltering, fetchNextPage]);

  // Fetch recent indexing tasks
  const fetchRecentTasks = useCallback(async () => {
    try {
      console.log(`Fetching recent indexing tasks for ads index: ${adsIndexId}`);
      const tasks = await fetchIndexingTasks(adsIndexId);

      if (tasks && tasks.length > 0) {
        console.log(`Received ${tasks.length} indexing tasks`);

        // 각 태스크의 상태별로 로그
        const statusCounts: Record<string, number> = {};
        tasks.forEach((task: IndexingTask) => {
          statusCounts[task.status || 'unknown'] = (statusCounts[task.status || 'unknown'] || 0) + 1;
        });
        console.log('Task status distribution:', statusCounts);

        // Create a map of all tasks by video ID for easy lookup
        const taskMap = new Map<string, IndexingTask>();
        tasks.forEach((task: IndexingTask) => {
          if (task.video_id) {
            taskMap.set(task.video_id, task);
          }
        });

        // Get all videos that are still in indexing process
        const indexingTasks = tasks.filter((task: IndexingTask) => task.status !== 'ready');

        // Filter for videos still in indexing (not ready)
        const newIndexingItems = indexingTasks
          .map((task: IndexingTask) => {
            // 인덱싱 중인 비디오의 상세 정보 로그
            console.log(`Indexing task details for ${task.video_id || 'unknown video'}:`, {
              id: task._id,
              status: task.status,
              videoId: task.video_id,
              hasSystemMetadata: !!task.system_metadata
            });

            return {
              id: task.video_id || '',
              taskId: task._id,
              title: task.system_metadata?.filename || task.video_id || 'Untitled Video',
              status: task.status || 'processing',
              duration: task.system_metadata?.duration ? formatDuration(task.system_metadata.duration) : undefined
            };
          });

        console.log(`Created ${newIndexingItems.length} indexing item entries for display`);
        setRecentUploads(newIndexingItems);

        // Update existing items to mark as indexing or not indexing
        setAdItems(prev => {
          return prev.map(item => {
            const task = taskMap.get(item.id);

            // 1. 이 아이템에 대한 태스크가 있고 인덱싱 중이면 isIndexing=true로 설정
            if (task && task.status !== 'ready') {
              console.log(`Marking video ${item.id} as still indexing with status: ${task.status}`);
              return {
                ...item,
                isIndexing: true,
                indexingStatus: task.status,
                // 인덱싱 중일 땐 태그를 비움
                tags: [],
                status: task.status
              };
            }
            // 2. 이 아이템에 대한 태스크가 있고 인덱싱이 완료되었으면 isIndexing=false로 설정
            else if (task && task.status === 'ready') {
              console.log(`Marking video ${item.id} as indexing complete`);
              return {
                ...item,
                isIndexing: false,
                indexingStatus: undefined,
                status: undefined
              };
            }
            // 3. 이 아이템에 대한 태스크가 없으면 그대로 반환
            return item;
          });
        });

        // If any video just completed indexing, trigger a refetch of all videos
        const justCompleted = tasks.filter((task: IndexingTask) => task.status === 'ready');
        if (justCompleted.length > 0) {
          console.log(`${justCompleted.length} videos just completed indexing, refreshing all videos`);

          // Get any video IDs that were previously indexing but now are complete
          const completedVideoIds = justCompleted
            .map(task => task.video_id)
            .filter(Boolean) as string[];

          console.log('Completed video IDs:', completedVideoIds);

          // Force immediate refresh if we have videos that just completed
          if (completedVideoIds.length > 0 && refetch) {
            refetch();
          }
        }
      } else {
        console.log('No indexing tasks found');
        setRecentUploads([]);
      }
    } catch (error) {
      console.error('Error fetching indexing tasks:', error);
    }
  }, [adsIndexId, refetch]);

  // Format duration in seconds to MM:SS format
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Call fetchRecentTasks when component mounts and after upload completes
  useEffect(() => {
    fetchRecentTasks();

    // Poll for updates every 10 seconds to check indexing status
    const intervalId = setInterval(() => {
      fetchRecentTasks();
      // Also refetch index data to update video count
      refetchIndex();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [fetchRecentTasks, refetchIndex]);

  // Combine indexing videos with regular videos for display
  const combinedItems = useMemo(() => {
    // Create a Map with video IDs as keys to avoid duplicates
    const itemsMap = new Map(
      adItems.map(item => [item.id, item])
    );

    // Add indexing videos from recentUploads
    recentUploads.forEach(video => {
      if (!itemsMap.has(video.id) && video.id) {
        itemsMap.set(video.id, {
          id: video.id,
          title: video.title,
          thumbnailUrl: '',
          videoUrl: '',
          tags: [],
          isIndexing: true,
          status: video.status || 'processing'
        });
      }
    });

    return Array.from(itemsMap.values());
  }, [adItems, recentUploads]);

  // Filter combined items when using search filters
  const displayItems = useMemo(() => {
    if (isFiltering) {
      return filteredItems;
    }
    return combinedItems;
  }, [isFiltering, filteredItems, combinedItems]);

  // Total video count calculation based on different sources
  const totalVideoCount = useMemo(() => {
    // If we're filtering, use the filtered count
    if (isFiltering) {
      return filteredItems.length;
    }

    // If we have index data, use that count
    if (indexData?.video_count) {
      return indexData.video_count;
    }

    // Fallback to the count of loaded videos
    if (adItems.length > 0) {
      return adItems.length;
    }

    // Otherwise use 0 as default
    return 0;
  }, [isFiltering, filteredItems.length, indexData?.video_count, adItems.length]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-zinc-100">
        {/* Sidebar */}
        <Sidebar activeMenu="ads-library" />

        {/* Main content */}
        <div className="flex-1 flex flex-col ml-20 bg-zinc-100">
          <div className="mx-auto w-4/5">
            {/* Fixed header area - combined all sticky elements */}
            <div className="fixed top-0 ml-5 z-50 bg-zinc-100 w-[calc(80%-5rem)]">
              {/* Search area with solid background */}
              <div className="bg-zinc-100 -mx-4 w-full">
                <div className="p-4 mt-2">
                  <SearchBar
                    onSearch={handleSearch}
                    onClear={handleClearSearch}
                    placeholder="What are you looking for?"
                    defaultValue={searchQuery}
                  />
                </div>

                {/* Action buttons and filter tabs - hide when search results are shown */}
                {!searchSubmitted && (
                  <div className="px-4 pb-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <ActionButtons
                          onUpload={handleUpload}
                          onFilter={handleFilter}
                        />
                        {/* Active filter indicators */}
                        {getTotalActiveFilterCount() > 0 && (
                          <div className="flex items-center">
                            {/* Active filters display */}
                            <div className="ml-3 flex flex-wrap items-center gap-2">
                              {Object.entries(activeFilters).map(([category, values]) =>
                                values.length > 0 && (
                                  <div key={category} className="flex items-center bg-light-purple px-2 py-1 rounded-md">
                                    <span className="text-sm font-medium text-gray-800 mr-1">
                                      {capitalizeText(category.replace(/_/g, ' '))}:
                                    </span>
                                    <span className="text-sm">
                                      {values.join(', ')}
                                    </span>
                                    <button
                                      onClick={() => resetCategoryFilters(category)}
                                      className="ml-1 text-gray-600 hover:text-gray-700 cursor-pointer"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                            <button
                              onClick={resetAllFilters}
                              className="ml-2 text-sm hover:text-red cursor-pointer"
                            >
                              Clear All
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="text-sm">
                        {isFiltering ? filteredItems.length : totalVideoCount} Videos
                        {processingMetadata && videosInProcessing.length > 0 && (
                          <span className="ml-2 text-blue-500 flex items-center">
                            <span className="mr-2">Processing metadata... ({videosInProcessing.length} Videos)</span>
                            <div className="w-4 h-4">
                              <LoadingSpinner />
                            </div>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Filter Menu */}
                    {showFilterMenu && (
                      <div className="relative">
                        <div className="absolute z-[100] mt-1 bg-white rounded-[45.60px] overflow-hidden p-3">
                          {selectedFilterCategory === null ? (
                            <div className="bg-white cursor-pointer">
                              {filterCategories.map((category) => (
                                <button
                                  key={category.id}
                                  className="flex items-center justify-between w-full text-left px-4 py-2 text-md hover:bg-gray-200 cursor-pointer"
                                  onClick={() => handleFilterCategorySelect(category.id)}
                                >
                                  <span>{capitalizeText(category.label.replace(/_/g, ' '))}</span>
                                  {getActiveCategoryFilterCount(category.id) > 0 && (
                                    <span className="ml-2 bg-light-purple text-xs font-medium px-2 py-0.5 rounded-full">
                                      {getActiveCategoryFilterCount(category.id)}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="p-4 w-54 bg-white rounded-[45.60px]">
                              <div className="flex justify-between items-center mb-3">
                                <h3 className="font-medium text-md">
                                  {capitalizeText((filterCategories.find(c => c.id === selectedFilterCategory)?.label || '').replace(/_/g, ' '))}
                                </h3>
                                <div className="flex items-center">
                                  {getActiveCategoryFilterCount(selectedFilterCategory) > 0 && (
                                    <button
                                      className="text-sm hover:text-red mr-3 cursor-pointer"
                                      onClick={() => resetCategoryFilters(selectedFilterCategory)}
                                    >
                                      Clear
                                    </button>
                                  )}
                                  <button
                                    className="hover:text-gray-500 cursor-pointer"
                                    onClick={() => setSelectedFilterCategory(null)}
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                  </button>
                                </div>
                              </div>

                              {/* Filter options */}
                              <div className="max-h-60 overflow-y-auto">
                                {filterOptions[selectedFilterCategory]?.length > 0 ? (
                                  <div className="space-y-2">
                                    {filterOptions[selectedFilterCategory].map((option, index) => (
                                      <div key={index} className="flex items-center cursor-pointer hover:bg-gray-200 px-2 py-1 rounded">
                                        <input
                                          id={`filter-${selectedFilterCategory}-${index}`}
                                          type="checkbox"
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                                          checked={isFilterActive(selectedFilterCategory, option)}
                                          onChange={() => toggleFilter(selectedFilterCategory, option)}
                                        />
                                        <label
                                          htmlFor={`filter-${selectedFilterCategory}-${index}`}
                                          className="ml-2 block text-md cursor-pointer"
                                        >
                                          {capitalizeText(option)}
                                        </label>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-500">No options available</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Backdrop to close menu when clicking outside */}
                        <div
                          className="fixed inset-0 z-[90]"
                          onClick={closeFilterMenu}
                        ></div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Table header with solid background - hide when search results are shown */}
              {!searchSubmitted && (
                <div className="bg-zinc-100 w-full">
                  <div className="flex border-b pb-3 w-full">
                    {COLUMNS.map(column => (
                      <div
                        key={column.id}
                        className="font-medium text-center text-md flex-shrink-0"
                        style={{ width: column.width }}
                      >
                        {column.label.includes('\n')
                          ? column.label.split('\n').map((part, i) => (
                              <div key={i}>{capitalizeText(part)}</div>
                            ))
                          : capitalizeText(column.label)
                        }
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Content area with padding to account for fixed header */}
            <div className={`${searchSubmitted ? 'pt-[90px]' : 'pt-[185px]'} w-full`}>
              {searchSubmitted ? (
                <div className="px-4 w-full">
                  <SearchResults
                    textSearchQuery={searchQuery}
                    textSearchSubmitted={searchSubmitted}
                    indexId={adsIndexId}
                  />
                </div>
              ) : (
                <div className="px-4">
                  {/* Video content grid */}
                  {isLoading ? (
                    <div className="flex flex-col justify-center items-center h-40">
                      <LoadingSpinner />
                      <p className="mt-4 text-gray-500">Loading videos...</p>
                    </div>
                  ) : isError ? (
                    <div className="flex justify-center items-center h-40 text-red-500">
                      Error loading data: {error instanceof Error ? error.message : 'Unknown error'}
                    </div>
                  ) : displayItems.length === 0 ? (
                    <div className="flex justify-center items-center h-40 text-gray-500">
                      {isFiltering ? 'No videos match the current filters' : 'No videos available'}
                    </div>
                  ) : (
                    <div className="mt-3 ml-2">
                      {displayItems.map(item => (
                        item.isIndexing ? (
                          // Special rendering for indexing videos
                          <div key={item.id} className="flex w-full mb-4">
                            <div className="w-[320px] flex-shrink-0 mr-4">
                              <div className="relative aspect-video bg-black rounded-[45.60px] overflow-hidden">
                                {/* Black background for indexing videos */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                                  <div className="w-10 h-10 mb-2 rounded-full bg-black bg-opacity-40 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                                  </div>
                                  <div className="text-white text-sm font-medium text-center bg-black bg-opacity-40 px-2 py-1 rounded">
                                    {item.status && item.status !== 'unknown'
                                      ? `${item.status.charAt(0).toUpperCase() + item.status.slice(1)}`
                                      : 'Processing'}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2">
                                <p className="text-sm font-medium truncate">{item.title}</p>
                              </div>
                            </div>
                            {/* Empty columns for consistency with ContentItem layout */}
                            {COLUMNS.slice(1).map(column => (
                              <div
                                key={`${item.id}-${column.id}`}
                                className="flex-shrink-0 text-center flex items-center justify-center"
                                style={{ width: column.width }}
                              >
                                {column.id === 'video' ? null : (
                                  <div className="flex items-center justify-center">
                                    <div className="w-5 h-5">
                                      <LoadingSpinner />
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          // Regular ContentItem for indexed videos
                          <ContentItem
                            key={item.id}
                            videoId={item.id}
                            indexId={adsIndexId}
                            thumbnailUrl={item.thumbnailUrl}
                            title={item.title}
                            videoUrl={item.videoUrl}
                            tags={item.tags}
                            metadata={item.metadata}
                            isLoadingMetadata={videosInProcessing.includes(item.id)}
                            onMetadataUpdated={() => {
                              // Refresh the content after user updates metadata
                              console.log('Metadata updated by user, refreshing metadata for video', item.id);
                              refreshVideoMetadata(item.id);
                            }}
                          />
                        )
                      ))}

                      {/* Load more button - only show when not filtering */}
                      {!isFiltering && hasNextPage && (
                        <div
                          className="flex justify-center py-4 mb-8"
                          ref={observerRef}
                        >
                          {isFetchingNextPage ? (
                            <div className="flex items-center space-x-2">
                              <LoadingSpinner />
                              <span className="text-gray-500">Loading more videos...</span>
                            </div>
                          ) : (
                            <div className="h-10 w-full" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Video Uploader Modal */}
      {showUploader && (
        <VideoUploader
          indexId={adsIndexId}
          onUploadComplete={handleUploadComplete}
          onClose={() => setShowUploader(false)}
        />
      )}
    </QueryClientProvider>
  );
}