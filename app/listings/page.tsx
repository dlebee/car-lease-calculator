'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LeaseData, SavedCars, saveToStorage, loadFromStorage, createNewCar } from '@/lib/leaseData';
import Navigation from '@/components/Navigation';

const FILTERS_STORAGE_KEY = 'lease-listings-filters';
const SEARCH_RESULTS_STORAGE_KEY = 'lease-listings-search-results';
const SEARCH_CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes in milliseconds

const defaultFilters = {
  make: '',
  model: '',
  tier: '',
  yearMin: '',
  yearMax: '',
  fuel: '',
  priceMin: '',
  priceMax: '',
  state: '',
  zip: '',
  distance: '50',
  vin: '',
  dealershipOnly: false, // Filter for dealership listings only (vs private sellers)
};

interface Listing {
  vin: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    fuel?: string;
    trim?: string;
    bodyType?: string;
    baseMsrp?: number; // Base MSRP from manufacturer
    baseInvoice?: number; // Base invoice price
  };
  retailListing?: {
    price: number;
    miles?: number; // Mileage in miles
    state?: string;
    city?: string;
    address?: string;
    dealer?: string; // Dealer name (e.g., "KingMitsubishiHyundai New")
    dealership?: {
      name?: string;
      address?: string;
    };
  };
}

export default function ListingsPage() {
  // Load filters from localStorage on mount
  const loadFiltersFromStorage = () => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
        if (saved) {
          const loaded = JSON.parse(saved);
          // Ensure all values are properly initialized to prevent controlled/uncontrolled warning
          return {
            make: typeof loaded.make === 'string' ? loaded.make : '',
            model: typeof loaded.model === 'string' ? loaded.model : '',
            tier: typeof loaded.tier === 'string' ? loaded.tier : '',
            yearMin: typeof loaded.yearMin === 'string' ? loaded.yearMin : '',
            yearMax: typeof loaded.yearMax === 'string' ? loaded.yearMax : '',
            fuel: typeof loaded.fuel === 'string' ? loaded.fuel : '',
            priceMin: typeof loaded.priceMin === 'string' ? loaded.priceMin : '',
            priceMax: typeof loaded.priceMax === 'string' ? loaded.priceMax : '',
            state: typeof loaded.state === 'string' ? loaded.state : '',
            zip: typeof loaded.zip === 'string' ? loaded.zip : '',
            distance: typeof loaded.distance === 'string' ? loaded.distance : '50',
            vin: typeof loaded.vin === 'string' ? loaded.vin : '',
            dealershipOnly: typeof loaded.dealershipOnly === 'boolean' ? loaded.dealershipOnly : false,
          };
        }
      } catch (error) {
        console.error('Error loading filters from localStorage:', error);
      }
    }
    return defaultFilters;
  };

  const [filters, setFilters] = useState(loadFiltersFromStorage);
  
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  // Load cached search results on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(SEARCH_RESULTS_STORAGE_KEY);
        if (cached) {
          const cacheData = JSON.parse(cached);
          // Check if cache is still valid (not expired)
          if (Date.now() - cacheData.timestamp < SEARCH_CACHE_EXPIRY) {
            setListings(cacheData.listings || []);
            setTotalPages(cacheData.totalPages || 1);
            setCurrentPage(cacheData.currentPage || 1);
            setHasSearched(true);
          }
        }
      } catch (error) {
        console.error('Error loading search results from cache:', error);
      }
    }
  }, []); // Only run on mount

  // Save filters to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
      } catch (error) {
        console.error('Error saving filters to localStorage:', error);
      }
    }
  }, [filters]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFilters((prev) => {
      const updated = { 
        ...defaultFilters, 
        ...prev, 
        [name]: type === 'checkbox' ? checked : value 
      };
      // Save to localStorage immediately
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(updated));
        } catch (error) {
          console.error('Error saving filters to localStorage:', error);
        }
      }
      return updated;
    });
  };

  const handleSearch = async (page: number = 1) => {
    setIsLoading(true);
    setError('');
    setHasSearched(true);

    try {
      // Build query params first to create consistent cache key
      const queryParams = new URLSearchParams();
      
      // Add filters to query params (excluding yearMin/yearMax, tier, and dealershipOnly which are handled separately)
      Object.entries(filters).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '' && key !== 'yearMin' && key !== 'yearMax' && key !== 'tier' && key !== 'dealershipOnly') {
          queryParams.append(key, value.trim());
        }
      });
      
      // Handle tier/trim filter (Auto.dev uses vehicle.trim)
      if (filters.tier && filters.tier.trim() !== '') {
        queryParams.append('vehicle.trim', filters.tier.trim());
      }
      
      // Note: Auto.dev API doesn't have a direct filter for dealership vs private seller
      // We'll filter client-side after fetching results
      
      // Handle year range
      if (filters.yearMin || filters.yearMax) {
        const yearMin = filters.yearMin || '1900';
        const yearMax = filters.yearMax || new Date().getFullYear().toString();
        queryParams.append('vehicle.year', `${yearMin}-${yearMax}`);
      }
      
      queryParams.append('page', page.toString());
      queryParams.append('limit', '20');

      const cacheKey = queryParams.toString();
      
      // Check cache first
      if (typeof window !== 'undefined') {
        try {
          const cached = localStorage.getItem(SEARCH_RESULTS_STORAGE_KEY);
          if (cached) {
            const cacheData = JSON.parse(cached);
            if (cacheData.key === cacheKey && Date.now() - cacheData.timestamp < SEARCH_CACHE_EXPIRY) {
              // Use cached results
              setListings(cacheData.listings);
              setTotalPages(cacheData.totalPages);
              setCurrentPage(page);
              setIsLoading(false);
              return;
            }
          }
        } catch (error) {
          console.error('Error reading cache:', error);
        }
      }

      const response = await fetch(`/api/search-listings?${queryParams.toString()}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to search listings');
      }

      if (result.success && result.data) {
        let listingsData: Listing[] = [];
        let totalPagesData = 1;
        
        // Handle single VIN response vs array response
        if (result.data.data) {
          if (Array.isArray(result.data.data)) {
            listingsData = result.data.data;
            
            // Filter for dealership only if requested
            // Check if retailListing.dealer or retailListing.dealership exists (dealership listings) vs private sellers
            if (filters.dealershipOnly) {
              listingsData = listingsData.filter((listing) => {
                // A listing is from a dealership if it has a dealer field or dealership object/name
                return listing.retailListing?.dealer || listing.retailListing?.dealership?.name || false;
              });
            }
            
            // Sort by price (least expensive first)
            listingsData.sort((a, b) => {
              const priceA = a.retailListing?.price || 0;
              const priceB = b.retailListing?.price || 0;
              return priceA - priceB;
            });
            
            // Check if API returned pagination metadata
            if (result.data.pagination) {
              // Use API pagination info if available
              const totalResults = result.data.pagination.total || listingsData.length;
              const limit = result.data.pagination.limit || 20;
              totalPagesData = Math.ceil(totalResults / limit);
            } else {
              // Estimate: if we got 20 results, assume there might be more pages
              // This is a conservative estimate - actual total pages may be higher
              totalPagesData = listingsData.length === 20 ? page + 1 : page;
            }
          } else {
            // Single listing response
            listingsData = [result.data.data];
            totalPagesData = 1;
          }
        }
        
        setListings(listingsData);
        setTotalPages(totalPagesData);
        setCurrentPage(page);
        
        // Cache the results
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(SEARCH_RESULTS_STORAGE_KEY, JSON.stringify({
              key: cacheKey,
              listings: listingsData,
              totalPages: totalPagesData,
              currentPage: page,
              timestamp: Date.now(),
            }));
          } catch (error) {
            console.error('Error caching results:', error);
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setListings([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(1);
  };

  // Helper function to get listed price (MSRP)
  const getListedPrice = (listing: Listing): number | null => {
    return listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || null;
  };

  const handleAddToList = (listing: Listing) => {
    try {
      // Build notes with address and dealership info
      const notesParts: string[] = [];
      if (listing.retailListing?.dealer) {
        notesParts.push(`Dealer: ${listing.retailListing.dealer}`);
      } else if (listing.retailListing?.dealership?.name) {
        notesParts.push(`Dealership: ${listing.retailListing.dealership.name}`);
      }
      if (listing.retailListing?.dealership?.address) {
        notesParts.push(`Dealership Address: ${listing.retailListing.dealership.address}`);
      } else if (listing.retailListing?.address) {
        notesParts.push(`Address: ${listing.retailListing.address}`);
      }
      if (listing.retailListing?.city && listing.retailListing?.state) {
        notesParts.push(`Location: ${listing.retailListing.city}, ${listing.retailListing.state}`);
      }
      if (listing.vehicle.fuel) {
        notesParts.push(`Fuel Type: ${listing.vehicle.fuel}`);
      }
      if (listing.vehicle.bodyType) {
        notesParts.push(`Body Type: ${listing.vehicle.bodyType}`);
      }
      
      // Add contact information if available
      if ((listing.retailListing?.dealership as any)?.phone) {
        notesParts.push(`Phone: ${(listing.retailListing?.dealership as any).phone}`);
      } else if ((listing.retailListing as any)?.phone) {
        notesParts.push(`Phone: ${(listing.retailListing as any).phone}`);
      }
      if ((listing.retailListing?.dealership as any)?.email) {
        notesParts.push(`Email: ${(listing.retailListing?.dealership as any).email}`);
      } else if ((listing.retailListing as any)?.email) {
        notesParts.push(`Email: ${(listing.retailListing as any).email}`);
      }
      if ((listing.retailListing?.dealership as any)?.website) {
        notesParts.push(`Website: ${(listing.retailListing?.dealership as any).website}`);
      } else if ((listing.retailListing as any)?.website) {
        notesParts.push(`Website: ${(listing.retailListing as any).website}`);
      }
      
      // Add raw JSON data to notes
      notesParts.push(`\n--- Raw JSON Data ---\n${JSON.stringify(listing, null, 2)}`);
      
      // Determine MSRP and price
      const msrp = listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || 0;
      const price = listing.retailListing?.price || 0;
      
      // Calculate discount if MSRP and price are available
      let discount = 0;
      let discountAmount = 0;
      if (msrp > 0 && price > 0) {
        discountAmount = msrp - price;
        discount = (discountAmount / msrp) * 100;
      }
      
      // Create a new lease car object with defaults
      const newCar: LeaseData = {
        ...createNewCar(),
        id: Date.now().toString(),
        vin: listing.vin,
        carYear: listing.vehicle.year,
        carMake: listing.vehicle.make,
        carModel: listing.vehicle.model,
        carTier: listing.vehicle.trim || '',
        dealership: listing.retailListing?.dealer || listing.retailListing?.dealership?.name || '',
        msrp: msrp,
        discount: discount,
        discountAmount: discountAmount,
        capCostPercent: msrp > 0 ? (price / msrp) * 100 : 100,
        residualPercent: 60, // Default 60% residual
        apr: 4, // Default 4% APR
        marketFactor: 4 / 2400, // Convert APR to money factor
        leaseTerm: 36, // Default 36 months
        milesPerYear: 12000, // Default 12,000 miles per year
        notes: notesParts.join(' | '),
      };
      
      // Load existing cars and add new one
      const existingData = loadFromStorage();
      const updatedCars: SavedCars = {
        cars: existingData ? [...existingData.cars, newCar] : [newCar],
        currentCarId: newCar.id,
      };
      
      // Save to storage
      saveToStorage(updatedCars);
      
      // Show success message
      alert(`Added ${newCar.carYear} ${newCar.carMake} ${newCar.carModel} to your lease calculator!`);
      
      // Optionally redirect to calculator
      // window.location.href = '/';
    } catch (error) {
      alert('Error adding car: ' + (error as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Vehicle Listings Search
          </h1>
          <Link
            href="/"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Back to Calculator
          </Link>
        </div>

        <Navigation />

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
            Search Filters
          </h2>
          
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Note:</strong> This search automatically filters for new vehicles (0-100 miles) that are potentially leasable.
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Vehicle Filters */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Make
                </label>
                <input
                  type="text"
                  name="make"
                  value={filters.make}
                  onChange={handleFilterChange}
                  placeholder="e.g., Ford"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Model
                </label>
                <input
                  type="text"
                  name="model"
                  value={filters.model}
                  onChange={handleFilterChange}
                  placeholder="e.g., Explorer"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Tier/Trim
                </label>
                <input
                  type="text"
                  name="tier"
                  value={filters.tier}
                  onChange={handleFilterChange}
                  placeholder="e.g., Platinum, ST-Line"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Min Year
                </label>
                <input
                  type="number"
                  name="yearMin"
                  value={filters.yearMin}
                  onChange={handleFilterChange}
                  placeholder="e.g., 2020"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Max Year
                </label>
                <input
                  type="number"
                  name="yearMax"
                  value={filters.yearMax}
                  onChange={handleFilterChange}
                  placeholder="e.g., 2024"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Fuel Type
                </label>
                <select
                  name="fuel"
                  value={filters.fuel}
                  onChange={handleFilterChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="">Any</option>
                  <option value="gas">Gas</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="plug-in hybrid">Plug-in Hybrid</option>
                </select>
              </div>
              
              {/* Price Range */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Min Price ($)
                </label>
                <input
                  type="number"
                  name="priceMin"
                  value={filters.priceMin}
                  onChange={handleFilterChange}
                  placeholder="e.g., 20000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Max Price ($)
                </label>
                <input
                  type="number"
                  name="priceMax"
                  value={filters.priceMax}
                  onChange={handleFilterChange}
                  placeholder="e.g., 50000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              {/* Mileage Range - Read-only info */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Mileage Range
                </label>
                <input
                  type="text"
                  value="0-100 miles (New Cars)"
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
              
              {/* Location Filters */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  State (2-letter code)
                </label>
                <input
                  type="text"
                  name="state"
                  value={filters.state}
                  onChange={handleFilterChange}
                  placeholder="e.g., FL"
                  maxLength={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  ZIP Code
                </label>
                <input
                  type="text"
                  name="zip"
                  value={filters.zip}
                  onChange={handleFilterChange}
                  placeholder="e.g., 33132"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Distance (miles)
                </label>
                <input
                  type="number"
                  name="distance"
                  value={filters.distance}
                  onChange={handleFilterChange}
                  placeholder="50"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>
              
              {/* Dealership Only Filter */}
              <div className="md:col-span-2 lg:col-span-3">
                <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    name="dealershipOnly"
                    checked={filters.dealershipOnly}
                    onChange={handleFilterChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                  />
                  <span>Show only dealership listings (exclude private sellers)</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    (Note: Filtered client-side as API doesn't support this filter)
                  </span>
                </label>
              </div>
              
              {/* VIN Search */}
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Or search by VIN
                </label>
                <input
                  type="text"
                  name="vin"
                  value={filters.vin}
                  onChange={handleFilterChange}
                  placeholder="Enter 17-character VIN"
                  maxLength={17}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>
            
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Searching...
                  </>
                ) : (
                  'Search Listings'
                )}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setFilters(defaultFilters);
                  // Clear from localStorage
                  if (typeof window !== 'undefined') {
                    try {
                      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(defaultFilters));
                    } catch (error) {
                      console.error('Error clearing filters from localStorage:', error);
                    }
                  }
                  setListings([]);
                  setHasSearched(false);
                  setError('');
                }}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {hasSearched && !isLoading && listings.length === 0 && !error && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 p-4 mb-6">
            <p className="text-yellow-800 dark:text-yellow-200">No listings found matching your criteria.</p>
          </div>
        )}

        {listings.length > 0 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Results ({listings.length})
              </h2>
              
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSearch(currentPage - 1)}
                    disabled={currentPage === 1 || isLoading}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="px-4 py-2 text-gray-700 dark:text-gray-300">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => handleSearch(currentPage + 1)}
                    disabled={currentPage >= totalPages || isLoading}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {listings.map((listing, index) => (
                <div
                  key={`${listing.vin}-${index}`}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 hover:shadow-xl transition-shadow"
                >
                  <div className="mb-3">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {listing.vehicle.year} {listing.vehicle.make} {listing.vehicle.model}
                    </h3>
                    {listing.vehicle.trim && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">{listing.vehicle.trim}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    {(listing.vehicle.baseMsrp || listing.vehicle.baseInvoice) && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 dark:text-gray-400">MSRP:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          ${(listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || 0).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {listing.retailListing?.price && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 dark:text-gray-400">Price:</span>
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          ${listing.retailListing.price.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {(listing.vehicle.baseMsrp || listing.vehicle.baseInvoice) && listing.retailListing?.price && (
                      <div className="flex justify-between items-center pt-1 border-t border-gray-200 dark:border-gray-700">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">Discount:</span>
                        <span className="font-bold text-green-600 dark:text-green-400 text-base">
                          {((listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || 0) > 0 ? (((listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || 0) - listing.retailListing.price) / (listing.vehicle.baseMsrp || listing.vehicle.baseInvoice || 0) * 100).toFixed(1) : '0')}%
                        </span>
                      </div>
                    )}
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Miles:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {listing.retailListing?.miles !== undefined 
                          ? listing.retailListing.miles.toLocaleString() 
                          : 'N/A'}
                      </span>
                    </div>
                    
                    {listing.vehicle.fuel && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Fuel:</span>
                        <span className="text-gray-900 dark:text-white capitalize">
                          {listing.vehicle.fuel}
                        </span>
                      </div>
                    )}
                    
                    {(listing.retailListing?.dealer || listing.retailListing?.dealership?.name) && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Dealer:</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {listing.retailListing.dealer || listing.retailListing.dealership?.name}
                        </span>
                      </div>
                    )}
                    
                    {(listing.retailListing?.address || listing.retailListing?.dealership?.address) && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Address:</span>
                        <span className="text-gray-900 dark:text-white text-xs">
                          {listing.retailListing?.dealership?.address || listing.retailListing?.address}
                        </span>
                      </div>
                    )}
                    
                    {listing.retailListing?.city && listing.retailListing?.state && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Location:</span>
                        <span className="text-gray-900 dark:text-white">
                          {listing.retailListing.city}, {listing.retailListing.state}
                        </span>
                      </div>
                    )}
                    
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        VIN: {listing.vin}
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setSelectedListing(listing)}
                    className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Listing Detail Modal */}
      {selectedListing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {selectedListing.vehicle.year} {selectedListing.vehicle.make} {selectedListing.vehicle.model}
                  </h2>
                  {selectedListing.vehicle.trim && (
                    <p className="text-lg text-gray-600 dark:text-gray-400 mt-1">{selectedListing.vehicle.trim}</p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedListing(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {(selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice) && (
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">MSRP</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      ${(selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice || 0).toLocaleString()}
                    </div>
                  </div>
                )}
                {selectedListing.retailListing?.price && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Price</div>
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      ${selectedListing.retailListing.price.toLocaleString()}
                    </div>
                  </div>
                )}
                {(selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice) && selectedListing.retailListing?.price && (
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Discount</div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {((selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice || 0) > 0 ? (((selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice || 0) - selectedListing.retailListing.price) / (selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice || 0) * 100).toFixed(1) : '0')}%
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      ${(((selectedListing.vehicle.baseMsrp || selectedListing.vehicle.baseInvoice || 0) - selectedListing.retailListing.price)).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Mileage</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {selectedListing.retailListing?.miles !== undefined 
                      ? `${selectedListing.retailListing.miles.toLocaleString()} miles`
                      : 'N/A'}
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                  Vehicle Details
                </h3>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Year:</span>
                    <span className="ml-2 text-gray-900 dark:text-white font-medium">{selectedListing.vehicle.year}</span>
                  </div>
                  
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Make:</span>
                    <span className="ml-2 text-gray-900 dark:text-white font-medium">{selectedListing.vehicle.make}</span>
                  </div>
                  
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Model:</span>
                    <span className="ml-2 text-gray-900 dark:text-white font-medium">{selectedListing.vehicle.model}</span>
                  </div>
                  
                  {selectedListing.vehicle.trim && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Trim:</span>
                      <span className="ml-2 text-gray-900 dark:text-white font-medium">{selectedListing.vehicle.trim}</span>
                    </div>
                  )}
                  
                  {selectedListing.vehicle.fuel && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Fuel Type:</span>
                      <span className="ml-2 text-gray-900 dark:text-white font-medium capitalize">{selectedListing.vehicle.fuel}</span>
                    </div>
                  )}
                  
                  {selectedListing.vehicle.bodyType && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Body Type:</span>
                      <span className="ml-2 text-gray-900 dark:text-white font-medium capitalize">{selectedListing.vehicle.bodyType}</span>
                    </div>
                  )}
                  
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Miles:</span>
                    <span className="ml-2 text-gray-900 dark:text-white font-medium">
                      {selectedListing.retailListing?.miles !== undefined 
                        ? selectedListing.retailListing.miles.toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                  
                  <div className="col-span-2">
                    <span className="text-gray-600 dark:text-gray-400">VIN:</span>
                    <span className="ml-2 text-gray-900 dark:text-white font-mono text-xs">{selectedListing.vin}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                  Dealership & Location
                </h3>
                
                <div className="space-y-2 text-sm">
                  {(selectedListing.retailListing?.dealer || selectedListing.retailListing?.dealership?.name) && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Dealer:</span>
                      <span className="ml-2 text-gray-900 dark:text-white font-medium">
                        {selectedListing.retailListing.dealer || selectedListing.retailListing.dealership?.name}
                      </span>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing?.dealership?.address || selectedListing.retailListing?.address) && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Address:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">{selectedListing.retailListing?.dealership?.address || selectedListing.retailListing?.address}</span>
                    </div>
                  )}
                  
                  {selectedListing.retailListing?.city && selectedListing.retailListing?.state && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Location:</span>
                      <span className="ml-2 text-gray-900 dark:text-white">{selectedListing.retailListing.city}, {selectedListing.retailListing.state}</span>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing?.dealership as any)?.phone && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Phone:</span>
                      <a href={`tel:${(selectedListing.retailListing?.dealership as any).phone}`} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing?.dealership as any).phone}
                      </a>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing?.dealership as any)?.email && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Email:</span>
                      <a href={`mailto:${(selectedListing.retailListing?.dealership as any).email}`} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing?.dealership as any).email}
                      </a>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing?.dealership as any)?.website && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Website:</span>
                      <a href={(selectedListing.retailListing?.dealership as any).website} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing?.dealership as any).website}
                      </a>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing as any)?.phone && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Phone:</span>
                      <a href={`tel:${(selectedListing.retailListing as any).phone}`} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing as any).phone}
                      </a>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing as any)?.email && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Email:</span>
                      <a href={`mailto:${(selectedListing.retailListing as any).email}`} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing as any).email}
                      </a>
                    </div>
                  )}
                  
                  {(selectedListing.retailListing as any)?.website && (
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Website:</span>
                      <a href={(selectedListing.retailListing as any).website} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">
                        {(selectedListing.retailListing as any).website}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Raw JSON Section */}
              <div className="mb-6">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {showRawJson ? 'Hide' : 'Show'} Raw JSON Data
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-600 dark:text-gray-400 transition-transform ${showRawJson ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showRawJson && (
                  <div className="mt-2 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto max-h-96">
                    <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {JSON.stringify(selectedListing, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    handleAddToList(selectedListing);
                    setSelectedListing(null);
                  }}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-colors"
                >
                  Add to Lease Calculator
                </button>
                <button
                  onClick={() => setSelectedListing(null)}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}

