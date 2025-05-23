import React from 'react';
import { VideoData, VideosDropDownProps } from '@/types';
import { MenuItem, Select, Skeleton, SelectChangeEvent } from '@mui/material'
import clsx from 'clsx';
import LoadingSpinner from './LoadingSpinner';


const VideosDropDown: React.FC<VideosDropDownProps> = ({
  onVideoChange,
  videosData,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  selectedFile,
  taskId,
  footageVideoId
}) => {
  const ITEM_HEIGHT = 48;
  const MENU_MAX_HEIGHT = 5 * ITEM_HEIGHT;

  const handleChange = (event: SelectChangeEvent<string>) => {
    const newVideoId = event.target.value;
    onVideoChange(newVideoId);
  };

  const handleScroll = (event: React.UIEvent<HTMLUListElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full my-5">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="relative">
      <Select
        value={footageVideoId || ""}
        onChange={handleChange}
        disabled={!!selectedFile || !!taskId}
        className={clsx('h-9 w-full tablet:w-[200px]', 'pl-[1px]', 'truncate text-ellipsis')}
        renderValue={(value) => (
          <div className="truncate">
            {videosData?.pages.flatMap((page: { data: VideoData[] }) => page.data).find((video: VideoData) => video._id === value)?.system_metadata?.filename || "Select a video"}
          </div>
        )}
        MenuProps={{
          PaperProps: {
            style: {
              maxHeight: MENU_MAX_HEIGHT,
            },
          },
          MenuListProps: {
            sx: {
              padding: 0,
              maxHeight: MENU_MAX_HEIGHT,
              overflowY: 'auto',
              overflowX: 'hidden'
            },
            onScroll: handleScroll
          },
          anchorOrigin: {
            vertical: 'bottom',
            horizontal: 'left',
          },
          transformOrigin: {
            vertical: 'top',
            horizontal: 'left',
          },
          variant: "menu"
        }}
      >
        {videosData?.pages.flatMap((page: { data: VideoData[] }, pageIndex: number) =>
          page.data.map((video: VideoData) => (
            <MenuItem
              key={`${pageIndex}-${video._id}`}
              value={video._id}
              sx={{
                paddingX: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                display: 'block',
                width: '100%'
              }}
            >
              {video.system_metadata?.filename}
            </MenuItem>
          ))
        )}
        {isFetchingNextPage && (
          <MenuItem disabled sx={{ alignItems: 'flex-start', flexDirection: 'column', paddingX: 1.5 }}>
            <Skeleton variant="text" width={60} />
            <Skeleton variant="text" width={180} sx={{ mt: 0.5 }} />
          </MenuItem>
        )}
      </Select>
    </div>
  );
};

export default VideosDropDown;
