'use client';

import Navigation from '@/components/Navigation';
import ComparisonView from '@/components/ComparisonView';

export default function ComparisonPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Car Comparison
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
          Compare multiple lease options side by side
        </p>
        <Navigation />
        <ComparisonView />
      </div>
    </div>
  );
}

