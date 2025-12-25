'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 mb-6">
      <div className="flex gap-4">
        <Link
          href="/"
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            pathname === '/'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Calculator
        </Link>
        <Link
          href="/comparison"
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            pathname === '/comparison'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Comparison
        </Link>
      </div>
    </div>
  );
}

