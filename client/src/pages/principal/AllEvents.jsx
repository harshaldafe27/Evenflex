import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllEventsApi } from '../../api/event.api';
import { formatDate } from '../../utils/formatDate';
import Loader from '../../components/common/Loader';
import EmptyState from '../../components/common/EmptyState';
import SearchBar from '../../components/common/SearchBar';
import Pagination from '../../components/common/Pagination';
import { usePagination } from '../../hooks/usePagination';

export default function AllEvents() {
  const [search, setSearch] = useState('');
  const { page, limit, setPage } = usePagination(10);

  const { data, isLoading } = useQuery({
    queryKey: ['all-events', { search, page, limit }],
    queryFn: () => getAllEventsApi({ search, page, limit }).then((r) => r.data.data),
  });

  if (isLoading) return <Loader />;
  const events = data?.events || [];

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">All Events</h2>
      <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search events..." />
      {events.length === 0 ? <EmptyState message="No events found" /> : (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>{['Title', 'Date', 'Venue', 'Created By', 'Registrations', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {events.map((event) => (
                    <tr key={event._id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{event.title}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(event.date)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{event.venue}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{event.createdBy?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{event.registeredCount}/{event.capacity}</td>
                      <td className="px-4 py-3">
                        {event.isCompleted ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Completed</span>
                        ) : event.isPublished ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Published</span>
                        ) : event.approvalStatus === 'approved' ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">Approved</span>
                        ) : event.approvalStatus === 'pending' ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pending Approval</span>
                        ) : event.approvalStatus === 'rejected' ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">Rejected</span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Draft</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={data.meta.page} pages={data.meta.pages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
