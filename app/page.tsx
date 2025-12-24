'use client';

import { useState, useEffect } from 'react';
import LeaseCalculator from '@/components/LeaseCalculator';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Car Lease Calculator
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
          Your personal lease calculation tool
        </p>
        <LeaseCalculator />
      </div>
    </div>
  );
}
