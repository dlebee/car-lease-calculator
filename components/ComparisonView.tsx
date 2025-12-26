'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LeaseData,
  SavedCars,
  getCarDisplayName,
  getCarPayments,
  loadFromStorage,
  saveToStorage,
} from '@/lib/leaseData';

export default function ComparisonView() {
  const [savedCars, setSavedCars] = useState<SavedCars>({
    cars: [],
    currentCarId: null,
  });
  const [selectedCarIds, setSelectedCarIds] = useState<Set<string>>(new Set());
  const [overrideDownPayment, setOverrideDownPayment] = useState<string>('');
  const [carOverrides, setCarOverrides] = useState<{
    [carId: string]: {
      discount?: string;
      residualPercent?: string;
      apr?: string;
      marketFactor?: string;
      downPayment?: string;
      totalFees?: string;
    };
  }>({});
  const [isEditingOverride, setIsEditingOverride] = useState(false);
  const [lastSortedOrder, setLastSortedOrder] = useState<string[]>([]);
  const [editingTimeout, setEditingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [isFollowUpAnalyzing, setIsFollowUpAnalyzing] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [vinLookup, setVinLookup] = useState<{ [carId: string]: { vin: string; isLoading: boolean; error: string | null } }>({});

  // Load from localStorage
  useEffect(() => {
    const loaded = loadFromStorage();
    if (loaded && loaded.cars.length > 0) {
      setSavedCars(loaded);
      setSelectedCarIds(new Set(loaded.cars.map((c) => c.id)));
    }
  }, []);

  // Sync selectedCarIds when cars change
  useEffect(() => {
    if (savedCars.cars.length > 0) {
      if (selectedCarIds.size === 0) {
        setSelectedCarIds(new Set(savedCars.cars.map(car => car.id)));
      } else {
        const existingIds = new Set(savedCars.cars.map(car => car.id));
        const updatedSelectedIds = new Set([...selectedCarIds].filter(id => existingIds.has(id)));
        if (updatedSelectedIds.size === 0 && savedCars.cars.length > 0) {
          setSelectedCarIds(existingIds);
        } else {
          setSelectedCarIds(updatedSelectedIds);
        }
      }
    }
  }, [savedCars.cars]);

  const formatCurrency = (amount: number) => 
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Calculate expected residual percentage based on lease term and miles per year
  // Formula: Base 60% for 36 months, adjust by 0.5% per month difference
  // Adjusted for miles: 10k = +2.5%, 12k = baseline, 15k = -2.5%, 18k+ = -4.5%
  const getExpectedResidualPercent = (leaseTerm: number, milesPerYear: number = 12000): number => {
    const baseResidual = 60;
    const termAdjustment = (leaseTerm - 36) * 0.5;
    let residual = Math.max(0, Math.min(100, baseResidual - termAdjustment));
    
    // Adjust for miles per year (12,000 is baseline)
    if (milesPerYear <= 7500) {
      // Very low mileage = higher residual (+3-4%)
      residual += 3.5;
    } else if (milesPerYear <= 10000) {
      // Lower mileage = higher residual (+2-3%)
      residual += 2.5;
    } else if (milesPerYear <= 12000) {
      // Standard mileage = baseline (0%)
      // No adjustment
    }
    
    return Math.max(0, Math.min(100, residual));
  };

  // Helper function to get payments with optional overrides
  const getCarPaymentsWithOverride = (
    car: LeaseData, 
    overrideDownPaymentValue?: number,
    overrides?: { discount?: number; residualPercent?: number; apr?: number; marketFactor?: number; downPayment?: number; totalFees?: number }
  ) => {
    // Use overrides if provided, otherwise use car values
    const discount = overrides?.discount !== undefined ? overrides.discount : (car.discount || 0);
    const residualPercent = overrides?.residualPercent !== undefined ? overrides.residualPercent : car.residualPercent;
    
    // Prioritize APR override if provided, otherwise use marketFactor override, otherwise use car values
    let currentApr: number;
    let currentMoneyFactor: number;
    if (overrides?.apr !== undefined) {
      currentApr = overrides.apr;
      currentMoneyFactor = currentApr / 2400;
    } else if (overrides?.marketFactor !== undefined) {
      currentMoneyFactor = overrides.marketFactor;
      currentApr = currentMoneyFactor * 2400;
    } else {
      currentApr = car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0);
      currentMoneyFactor = car.marketFactor || (car.apr ? car.apr / 2400 : 0);
    }
    
    const downPaymentOverride = overrides?.downPayment !== undefined ? overrides.downPayment : (overrideDownPaymentValue !== undefined ? overrideDownPaymentValue : (car.downPayment || 0));
    
    // Recalculate with overrides
    const baseCapCost = car.msrp * (1 - discount / 100);
    const totalFees = overrides?.totalFees !== undefined 
      ? overrides.totalFees
      : ((car.tagTitleFilingFees || 0) + (car.handlingFees || 0) + (car.otherFees || 0));
    const totalDownPayment = downPaymentOverride + (car.equityTransfer || 0) + (car.dueAtSigning || 0);
    const adjustedCapCost = baseCapCost + totalFees - totalDownPayment;
    const adjustedCapCostWithTax = adjustedCapCost * (1 + (car.salesTaxPercent || 0) / 100);
    const residualValue = (car.msrp * residualPercent) / 100;
    const depreciation = adjustedCapCost - residualValue;
    const monthlyDepreciation = depreciation / car.leaseTerm;
    const monthlyRate = currentApr / 100 / 12;
    const monthlyFinanceCharge = (adjustedCapCost + residualValue) * monthlyRate;
    const baseMonthlyPayment = monthlyDepreciation + monthlyFinanceCharge;
    const salesTaxMultiplier = 1 + (car.salesTaxPercent || 0) / 100;
    const totalMonthlyPayment = baseMonthlyPayment * salesTaxMultiplier;
    
    return {
      baseCapCost,
      adjustedCapCost,
      adjustedCapCostWithTax,
      totalFees,
      totalDownPayment,
      residualValue,
      depreciation,
      monthlyDepreciation,
      monthlyFinanceCharge,
      baseMonthlyPayment,
      totalMonthlyPayment,
      currentApr,
      currentMoneyFactor,
    };
  };

  // Parse override down payment value
  const overrideDownPaymentValue = overrideDownPayment === '' ? undefined : parseFloat(overrideDownPayment) || 0;

  // Helper to get parsed overrides for a car
  const getCarOverrides = (carId: string) => {
    const overrides = carOverrides[carId];
    if (!overrides) return undefined;
    
    return {
      discount: overrides.discount !== undefined && overrides.discount !== '' ? parseFloat(overrides.discount) : undefined,
      residualPercent: overrides.residualPercent !== undefined && overrides.residualPercent !== '' ? parseFloat(overrides.residualPercent) : undefined,
      apr: overrides.apr !== undefined && overrides.apr !== '' ? parseFloat(overrides.apr) : undefined,
      marketFactor: overrides.marketFactor !== undefined && overrides.marketFactor !== '' ? parseFloat(overrides.marketFactor) : undefined,
      downPayment: overrides.downPayment !== undefined && overrides.downPayment !== '' ? parseFloat(overrides.downPayment) : undefined,
      totalFees: overrides.totalFees !== undefined && overrides.totalFees !== '' ? parseFloat(overrides.totalFees) : undefined,
    };
  };

  // Helper to update car override
  const updateCarOverride = (carId: string, field: 'discount' | 'residualPercent' | 'apr' | 'marketFactor' | 'downPayment' | 'totalFees', value: string) => {
    setIsEditingOverride(true);
    
    // Clear existing timeout
    if (editingTimeout) {
      clearTimeout(editingTimeout);
    }
    
    // Set new timeout to reset editing flag
    const timer = setTimeout(() => {
      setIsEditingOverride(false);
    }, 1500); // Wait 1.5 seconds after last change before re-sorting
    
    setEditingTimeout(timer);
    
    setCarOverrides(prev => ({
      ...prev,
      [carId]: {
        ...prev[carId],
        [field]: value,
      },
    }));
  };
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (editingTimeout) {
        clearTimeout(editingTimeout);
      }
    };
  }, [editingTimeout]);

  // Helper to clear car override
  const clearCarOverride = (carId: string, field: 'discount' | 'residualPercent' | 'apr' | 'marketFactor' | 'downPayment' | 'totalFees') => {
    setCarOverrides(prev => {
      const newOverrides = { ...prev[carId] };
      delete newOverrides[field];
      if (Object.keys(newOverrides).length === 0) {
        const updated = { ...prev };
        delete updated[carId];
        return updated;
      }
      return { ...prev, [carId]: newOverrides };
    });
  };

  // Filter to only selected cars, then sort by total monthly payment (with tax) - least expensive first
  const selectedCars = savedCars.cars.filter(car => selectedCarIds.has(car.id));
  
  // Calculate sorted cars
  const calculateSortedCars = () => {
    return [...selectedCars].sort((a, b) => {
      const paymentsA = getCarPaymentsWithOverride(a, overrideDownPaymentValue, getCarOverrides(a.id));
      const paymentsB = getCarPaymentsWithOverride(b, overrideDownPaymentValue, getCarOverrides(b.id));
      return paymentsA.totalMonthlyPayment - paymentsB.totalMonthlyPayment;
    });
  };
  
  // Helper to check if a car has any overrides
  const hasOverride = useCallback((carId: string) => {
    const overrides = carOverrides[carId];
    return overrides && (
      (overrides.discount !== undefined && overrides.discount !== '') ||
      (overrides.residualPercent !== undefined && overrides.residualPercent !== '') ||
      (overrides.apr !== undefined && overrides.apr !== '') ||
      (overrides.marketFactor !== undefined && overrides.marketFactor !== '') ||
      (overrides.downPayment !== undefined && overrides.downPayment !== '') ||
      (overrides.totalFees !== undefined && overrides.totalFees !== '')
    );
  }, [carOverrides]);

  // Calculate sorted cars - only sort unedited cars, keep edited ones in place
  const sortedCars = useMemo(() => {
    // If we have a last sorted order and some cars have overrides, maintain positions for edited cars
    if (lastSortedOrder.length > 0 && selectedCars.some(car => hasOverride(car.id))) {
      const orderMap = new Map(lastSortedOrder.map((id, idx) => [id, idx]));
      
      return [...selectedCars].sort((a, b) => {
        const aHasOverride = hasOverride(a.id);
        const bHasOverride = hasOverride(b.id);
        
        // If both have overrides, maintain their relative order from lastSortedOrder
        if (aHasOverride && bHasOverride) {
          const idxA = orderMap.get(a.id) ?? Infinity;
          const idxB = orderMap.get(b.id) ?? Infinity;
          return idxA - idxB;
        }
        
        // If only one has override, maintain its position from lastSortedOrder
        // Unedited cars will be sorted among themselves but respect edited car positions
        if (aHasOverride) {
          const idxA = orderMap.get(a.id) ?? Infinity;
          const idxB = orderMap.get(b.id);
          // If unedited car has a position, compare positions
          if (idxB !== undefined) {
            return idxA - idxB;
          }
          // Unedited car not in lastSortedOrder, keep edited car in its position
          return idxA - Infinity;
        }
        if (bHasOverride) {
          const idxA = orderMap.get(a.id);
          const idxB = orderMap.get(b.id) ?? Infinity;
          // If unedited car has a position, compare positions
          if (idxA !== undefined) {
            return idxA - idxB;
          }
          // Unedited car not in lastSortedOrder, keep edited car in its position
          return Infinity - idxB;
        }
        
        // Both unedited, sort by payment
        const paymentsA = getCarPaymentsWithOverride(a, overrideDownPaymentValue, getCarOverrides(a.id));
        const paymentsB = getCarPaymentsWithOverride(b, overrideDownPaymentValue, getCarOverrides(b.id));
        return paymentsA.totalMonthlyPayment - paymentsB.totalMonthlyPayment;
      });
    }
    
    // No overrides or no lastSortedOrder, sort all cars normally
    return [...selectedCars].sort((a, b) => {
      const paymentsA = getCarPaymentsWithOverride(a, overrideDownPaymentValue, getCarOverrides(a.id));
      const paymentsB = getCarPaymentsWithOverride(b, overrideDownPaymentValue, getCarOverrides(b.id));
      return paymentsA.totalMonthlyPayment - paymentsB.totalMonthlyPayment;
    });
  }, [selectedCars, overrideDownPaymentValue, carOverrides, lastSortedOrder, hasOverride]);
  
  // Update last sorted order whenever cars or overrides change (but not while actively editing)
  useEffect(() => {
    if (!isEditingOverride && sortedCars.length > 0) {
      const newOrder = sortedCars.map(car => car.id);
      const newOrderStr = newOrder.join(',');
      const lastOrderStr = lastSortedOrder.join(',');
      // Only update if order actually changed
      if (newOrderStr !== lastOrderStr) {
        setLastSortedOrder(newOrder);
      }
    }
  }, [sortedCars, isEditingOverride, lastSortedOrder]);

  // Early return AFTER all hooks
  if (savedCars.cars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-center">
        <p className="text-gray-600 dark:text-gray-400 text-xs">No cars to compare. Add at least one car to use the comparison view.</p>
      </div>
    );
  }

  const handleToggleCar = (carId: string) => {
    setSelectedCarIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(carId)) {
        newSet.delete(carId);
        if (newSet.size === 0 && savedCars.cars.length > 1) {
          return prev;
        }
      } else {
        newSet.add(carId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedCarIds(new Set(savedCars.cars.map(car => car.id)));
  };

  const handleUnselectAll = () => {
    if (savedCars.cars.length > 0) {
      setSelectedCarIds(new Set([savedCars.cars[0].id]));
    }
  };

  const handleSelectByMake = (make: string) => {
    const carsFromMake = savedCars.cars.filter(car => car.carMake === make);
    const allFromMakeSelected = carsFromMake.every(car => selectedCarIds.has(car.id));
    
    const newSelectedIds = new Set(selectedCarIds);
    if (allFromMakeSelected) {
      // Unselect all cars from this make
      carsFromMake.forEach(car => newSelectedIds.delete(car.id));
      // Ensure at least one car remains selected
      if (newSelectedIds.size === 0 && savedCars.cars.length > 0) {
        const firstOtherCar = savedCars.cars.find(c => c.carMake !== make);
        if (firstOtherCar) {
          newSelectedIds.add(firstOtherCar.id);
        }
      }
    } else {
      // Select all cars from this make (additive)
      carsFromMake.forEach(car => newSelectedIds.add(car.id));
    }
    setSelectedCarIds(newSelectedIds);
  };

  const handleDeleteCar = (carId: string) => {
    const carToDelete = savedCars.cars.find(c => c.id === carId);
    if (carToDelete && confirm(`Are you sure you want to delete ${getCarDisplayName(carToDelete)}?`)) {
      const updatedCars = savedCars.cars.filter(c => c.id !== carId);
      const updatedSelectedIds = new Set(selectedCarIds);
      updatedSelectedIds.delete(carId);
      
      const updatedSavedCars: SavedCars = {
        cars: updatedCars,
        currentCarId: savedCars.currentCarId === carId ? (updatedCars.length > 0 ? updatedCars[0].id : null) : savedCars.currentCarId,
      };
      
      setSavedCars(updatedSavedCars);
      setSelectedCarIds(updatedSelectedIds);
      saveToStorage(updatedSavedCars);
      
      // Clear overrides for deleted car
      setCarOverrides(prev => {
        const newOverrides = { ...prev };
        delete newOverrides[carId];
        return newOverrides;
      });
    }
  };

  // VIN Lookup Function
  const handleVINLookup = async (carId: string, vin: string) => {
    if (!vin || vin.length !== 17) {
      setVinLookup(prev => ({
        ...prev,
        [carId]: { vin, isLoading: false, error: 'Please enter a valid 17-character VIN' }
      }));
      return;
    }

    setVinLookup(prev => ({
      ...prev,
      [carId]: { vin, isLoading: true, error: null }
    }));

    try {
      const car = savedCars.cars.find(c => c.id === carId);
      const response = await fetch('/api/fetch-vin-with-msrp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vin: vin.trim().toUpperCase(),
          dealership: car?.dealership || '',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch VIN data');
      }

      if (result.success && result.data) {
        // Update the car with fetched data
        const updatedCars = savedCars.cars.map(c => {
          if (c.id === carId) {
            return {
              ...c,
              vin: result.data.vin,
              carYear: result.data.year || c.carYear,
              carMake: result.data.make || c.carMake,
              carModel: result.data.model || c.carModel,
              carTier: result.data.tier || c.carTier,
              msrp: result.data.msrp || c.msrp,
            };
          }
          return c;
        });

        const updatedSavedCars = {
          ...savedCars,
          cars: updatedCars,
        };
        setSavedCars(updatedSavedCars);
        saveToStorage(updatedSavedCars);

        setVinLookup(prev => ({
          ...prev,
          [carId]: { vin, isLoading: false, error: null }
        }));
      }
    } catch (error) {
      setVinLookup(prev => ({
        ...prev,
        [carId]: { vin, isLoading: false, error: (error as Error).message }
      }));
    }
  };

  // CSV Export Function
  const exportToCSV = () => {
    if (sortedCars.length === 0) {
      alert('Please select at least one car to export');
      return;
    }

    const headers = ['Field', ...sortedCars.map(car => getCarDisplayName(car))];
    const rows: string[][] = [];

    // Add override info if active
    const hasOverrides = overrideDownPayment !== '' || Object.keys(carOverrides).length > 0;
    if (hasOverrides) {
      rows.push(['', '']);
      rows.push(['COMPARISON OVERRIDES', '']);
      if (overrideDownPayment !== '') {
        rows.push(['Down Payment Override', formatCurrency(overrideDownPaymentValue || 0)]);
      }
      rows.push(['', '']);
      rows.push(['NOTE: All financial metrics below are calculated using the standardized overrides above', '']);
      rows.push(['', '']);
    }

    // Add all comparison fields
    const fields = [
      { label: 'Year', getValue: (car: LeaseData) => car.carYear || 'N/A' },
      { label: 'Make', getValue: (car: LeaseData) => car.carMake || 'N/A' },
      { label: 'Model', getValue: (car: LeaseData) => car.carModel || 'N/A' },
      { label: 'Tier', getValue: (car: LeaseData) => car.carTier || 'N/A' },
      { label: 'Dealership', getValue: (car: LeaseData) => car.dealership || 'N/A' },
      { label: 'VIN', getValue: (car: LeaseData) => car.vin || 'N/A' },
      { label: 'MSRP', getValue: (car: LeaseData) => car.msrp, format: 'currency' },
      { label: 'Discount %', getValue: (car: LeaseData) => car.discount || 0, format: 'percentage' },
      { label: 'Base Cap Cost', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.baseCapCost;
      }, format: 'currency' },
      { label: 'Adjusted Cap Cost', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.adjustedCapCost;
      }, format: 'currency' },
      { label: 'Residual %', getValue: (car: LeaseData) => car.residualPercent, format: 'percentage' },
      { label: 'Residual Value', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.residualValue;
      }, format: 'currency' },
      { label: 'Depreciation', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.depreciation;
      }, format: 'currency' },
      { label: 'Lease Term (months)', getValue: (car: LeaseData) => car.leaseTerm },
      { label: 'Miles Per Year', getValue: (car: LeaseData) => car.milesPerYear || 12000 },
      { label: 'APR %', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.currentApr;
      }, format: 'percentage' },
      { label: 'Monthly Depreciation', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.monthlyDepreciation;
      }, format: 'currency' },
      { label: 'Monthly Finance Charge', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.monthlyFinanceCharge;
      }, format: 'currency' },
      { label: 'Monthly Payment (with tax)', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.totalMonthlyPayment;
      }, format: 'currency' },
      { label: 'Total Lease Cost', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.totalMonthlyPayment * car.leaseTerm;
      }, format: 'currency' },
      { label: 'Total Fees', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.totalFees;
      }, format: 'currency' },
      { label: 'Total Down Payment', getValue: (car: LeaseData) => {
        const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
        return payments.totalDownPayment;
      }, format: 'currency' },
    ];

    fields.forEach(field => {
      const row: string[] = [field.label];
      sortedCars.forEach(car => {
        const value = field.getValue(car);
        let cellValue = '';
        if (field.format === 'currency') {
          cellValue = typeof value === 'number' ? value.toFixed(2) : '';
        } else if (field.format === 'percentage') {
          cellValue = typeof value === 'number' ? value.toFixed(2) : '';
        } else {
          cellValue = String(value);
        }
        row.push(cellValue);
      });
      rows.push(row);
    });

    const csvContent = [
      headers.map(h => h.includes(',') ? `"${h.replace(/"/g, '""')}"` : h).join(','),
      ...rows.map(row => row.map(cell => {
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lease-comparison-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // AI Analysis Functions
  const handleAnalyzeComparison = async () => {
    if (sortedCars.length === 0) {
      setAnalysisError('Please select at least one car to analyze');
      return;
    }

    setIsAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);

    try {
      const overrides: any = {};
      if (overrideDownPaymentValue !== undefined) {
        overrides.downPayment = overrideDownPaymentValue;
      }
      
      // Collect car-specific overrides
      const carOverridesData: any = {};
      sortedCars.forEach(car => {
        const carOverrides = getCarOverrides(car.id);
        if (carOverrides && Object.keys(carOverrides).length > 0) {
          carOverridesData[car.id] = carOverrides;
        }
      });

      const response = await fetch('/api/analyze-lease-comparison', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cars: sortedCars,
          overrides: Object.keys(overrides).length > 0 ? overrides : null,
          carOverrides: Object.keys(carOverridesData).length > 0 ? carOverridesData : null,
          customPrompt: customPrompt.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to analyze comparison');
      }

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);
      }
    } catch (error) {
      setAnalysisError((error as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFollowUpQuestion = async () => {
    if (!analysis || !followUpPrompt.trim()) {
      setAnalysisError('Please enter a follow-up question');
      return;
    }

    setIsFollowUpAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await fetch('/api/follow-up-lease-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          previousAnalysis: analysis,
          question: followUpPrompt.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to process follow-up question');
      }

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);
        setFollowUpPrompt('');
      }
    } catch (error) {
      setAnalysisError((error as Error).message);
    } finally {
      setIsFollowUpAnalyzing(false);
    }
  };

  if (sortedCars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">Please select at least one car to compare.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Down Payment Override */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
            Override Down Payment for All Cars:
          </label>
          <input
            type="number"
            value={overrideDownPayment}
            onChange={(e) => setOverrideDownPayment(e.target.value)}
            placeholder="Leave empty to use car's down payment"
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {overrideDownPayment !== '' && (
            <button
              onClick={() => setOverrideDownPayment('')}
              className="px-2 py-1 text-xs bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
        {overrideDownPayment !== '' && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            All calculations below use ${parseFloat(overrideDownPayment) || 0} as the down payment (equity transfer and due at signing are still included)
          </p>
        )}
      </div>

      {/* Car Selection Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Car Comparison</h2>
          <div className="flex gap-1">
            <button
              onClick={exportToCSV}
              className="px-2 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              Export CSV
            </button>
            <button
              onClick={handleSelectAll}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Select All
            </button>
            <button
              onClick={handleUnselectAll}
              className="px-2 py-1 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              Unselect All
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {(() => {
            // Group cars by make
            const carsByMake = savedCars.cars.reduce((acc, car) => {
              const make = car.carMake || 'Unknown';
              if (!acc[make]) {
                acc[make] = [];
              }
              acc[make].push(car);
              return acc;
            }, {} as Record<string, LeaseData[]>);

            return Object.entries(carsByMake).map(([make, cars]) => {
              const allFromMakeSelected = cars.every(car => selectedCarIds.has(car.id));
              const someFromMakeSelected = cars.some(car => selectedCarIds.has(car.id));
              
              return (
                <div key={make} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectByMake(make)}
                      className={`text-xs font-semibold px-2 py-1 rounded transition-colors ${
                        allFromMakeSelected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : someFromMakeSelected
                          ? 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-300 dark:hover:bg-blue-700'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={`Select all ${make} cars`}
                    >
                      {make} ({cars.length})
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-0">
                    {cars.map((car) => {
            const isSelected = selectedCarIds.has(car.id);
            const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
            return (
                        <div
                key={car.id}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border-2 transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400'
                }`}
              >
                          <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleCar(car.id)}
                  className="w-3 h-3 text-blue-600 rounded focus:ring-blue-500"
                  disabled={isSelected && selectedCarIds.size === 1}
                />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-gray-900 dark:text-white">{getCarDisplayName(car)}</span>
                  <span className="text-[10px] text-gray-600 dark:text-gray-400">
                    {formatCurrency(payments.totalMonthlyPayment)}/mo
                  </span>
                </div>
              </label>
                        </div>
            );
          })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="border-b-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
                <th className="text-left p-1.5 font-semibold text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-30 border-r border-gray-200 dark:border-gray-700 text-xs">Car</th>
                {sortedCars.map((car) => (
                  <th key={car.id} className="text-center p-1.5 font-semibold text-gray-900 dark:text-white min-w-[120px] bg-white dark:bg-gray-800 relative">
                    <div className="flex items-center justify-center gap-1">
                      <div className="flex-1">
                    <div className="font-bold text-xs">{getCarDisplayName(car)}</div>
                    {car.dealership && <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">{car.dealership}</div>}
                      </div>
                      <button
                        onClick={() => handleDeleteCar(car.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors p-0.5"
                        title="Delete car"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Vehicle Information */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Vehicle Information</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Make</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.carMake || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Model</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.carModel || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Tier</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.carTier || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">MSRP</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.msrp)}</td>
                ))}
              </tr>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">VIN</td>
                {sortedCars.map((car) => {
                  const vinLookupState = vinLookup[car.id];
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white text-xs">
                      <div className="flex flex-col items-center gap-1">
                        <div className="font-mono text-xs">{car.vin || 'N/A'}</div>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={vinLookupState?.vin || ''}
                            onChange={(e) => setVinLookup(prev => ({
                              ...prev,
                              [car.id]: { vin: e.target.value, isLoading: false, error: null }
                            }))}
                            placeholder="Enter VIN"
                            className="w-32 px-2 py-1 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono uppercase"
                            maxLength={17}
                          />
                          <button
                            onClick={() => handleVINLookup(car.id, vinLookupState?.vin || '')}
                            disabled={vinLookupState?.isLoading || !vinLookupState?.vin}
                            className="px-2 py-1 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Fetch vehicle details and MSRP"
                          >
                            {vinLookupState?.isLoading ? '...' : '🔍'}
                          </button>
                        </div>
                        {vinLookupState?.error && (
                          <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                            {vinLookupState.error}
                          </div>
                        )}
                        {vinLookupState && !vinLookupState.error && !vinLookupState.isLoading && car.vin && (
                          <div className="text-[10px] text-green-600 dark:text-green-400 mt-1">
                            ✓ Updated
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
              {sortedCars.some(car => car.dealership) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Dealership</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.dealership || 'N/A'}</td>
                  ))}
                </tr>
              )}

              {/* Lease Terms */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Lease Terms</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Lease Term (months)</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.leaseTerm}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Cap Cost %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.capCostPercent.toFixed(2)}%</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Discount</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.discount ? `-${car.discount.toFixed(1)}%` : '0%'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Discount Amount</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.discountAmount || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-blue-50 dark:bg-blue-900/20 z-10">Total Monthly Payment (with Tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center font-bold text-blue-600 dark:text-blue-400 text-xs">{formatCurrency(payments.totalMonthlyPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Residual %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.residualPercent.toFixed(1)}%</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-green-50 dark:bg-green-900/20">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-green-50 dark:bg-green-900/20 z-10">Expected Residual %<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">(Based on term & miles/year)</span></td>
                {sortedCars.map((car) => {
                  const expectedResidual = getExpectedResidualPercent(car.leaseTerm, car.milesPerYear || 12000);
                  const actualResidual = car.residualPercent;
                  const difference = actualResidual - expectedResidual;
                  const isGood = difference >= -2; // Within 2% is considered good
                  return (
                    <td key={car.id} className="p-1.5 text-center text-xs">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className={`font-semibold ${isGood ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                          {expectedResidual.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">
                          Actual: {actualResidual.toFixed(1)}%
                        </div>
                        <div className={`text-[10px] font-medium ${difference >= 0 ? 'text-green-600 dark:text-green-400' : difference >= -2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                          {difference >= 0 ? `+${difference.toFixed(1)}%` : `${difference.toFixed(1)}%`}
                        </div>
                        <div className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                          ({car.leaseTerm}mo, {(car.milesPerYear || 12000).toLocaleString()}/yr)
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">APR</td>
                {sortedCars.map((car) => {
                  const apr = car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0);
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{apr.toFixed(2)}%</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Market Factor</td>
                {sortedCars.map((car) => {
                  const marketFactor = car.marketFactor || (car.apr ? car.apr / 2400 : 0);
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{marketFactor.toFixed(6)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Sales Tax %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.salesTaxPercent.toFixed(1)}%</td>
                ))}
              </tr>
              {sortedCars.some(car => car.ficoScore8 > 0) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">FICO Score 8</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.ficoScore8 > 0 ? car.ficoScore8 : 'N/A'}</td>
                  ))}
                </tr>
              )}

              {/* Financials */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Financials</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Base Cap Cost</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.baseCapCost)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Adjusted Cap Cost</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.adjustedCapCost)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Adjusted Cap Cost (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.adjustedCapCostWithTax)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Residual Value</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.residualValue)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Tag/Title/Filing Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.tagTitleFilingFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Handling Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.handlingFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Other Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.otherFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total Fees</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.totalFees)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">
                  Down Payment
                  {overrideDownPayment !== '' && <span className="text-xs text-blue-600 dark:text-blue-400 block">(overridden)</span>}
                </td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                    {formatCurrency(overrideDownPaymentValue !== undefined ? overrideDownPaymentValue : (car.downPayment || 0))}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Equity Transfer</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.equityTransfer || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Due at Signing</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.dueAtSigning || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total Down Payment</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.totalDownPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Depreciation (Total)<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">Cap - Residual</span></td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const tooltipText = `Depreciation Calculation:\nCap Amount: ${formatCurrency(payments.adjustedCapCost)}\nResidual Value: ${formatCurrency(payments.residualValue)}\n\nTotal Depreciation:\n${formatCurrency(payments.adjustedCapCost)} - ${formatCurrency(payments.residualValue)} = ${formatCurrency(payments.depreciation)}`;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="tooltip-container flex flex-col items-center gap-0.5 cursor-help">
                        <div className="font-semibold">{formatCurrency(payments.depreciation)}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">
                          {formatCurrency(payments.adjustedCapCost)} - {formatCurrency(payments.residualValue)}
                        </div>
                        <div className="tooltip-text">{tooltipText}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Monthly Payments */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Monthly Payments</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Depreciation<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">Depreciation ÷ Months</span></td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const tooltipText = `Depreciation Calculation:\nTotal Depreciation: ${formatCurrency(payments.depreciation)}\n(Cap Amount: ${formatCurrency(payments.adjustedCapCost)} - Residual Value: ${formatCurrency(payments.residualValue)})\n\nMonthly Depreciation:\n${formatCurrency(payments.depreciation)} ÷ ${car.leaseTerm} months = ${formatCurrency(payments.monthlyDepreciation)}`;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="tooltip-container flex flex-col items-center gap-0.5 cursor-help">
                        <div className="font-semibold">{formatCurrency(payments.monthlyDepreciation)}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">
                          {formatCurrency(payments.depreciation)} ÷ {car.leaseTerm}
                        </div>
                        <div className="tooltip-text">{tooltipText}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Finance Charge<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">(Cap + Residual) × Rate</span></td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const monthlyRate = payments.currentApr / 100 / 12;
                  const tooltipText = `Finance Charge Calculation:\nCap Amount: ${formatCurrency(payments.adjustedCapCost)}\nResidual Value: ${formatCurrency(payments.residualValue)}\nAPR: ${payments.currentApr.toFixed(2)}%\nMonthly Rate: ${payments.currentApr.toFixed(2)}% ÷ 12 = ${(monthlyRate * 100).toFixed(4)}%\n\nMonthly Finance Charge:\n(${formatCurrency(payments.adjustedCapCost)} + ${formatCurrency(payments.residualValue)}) × ${(monthlyRate * 100).toFixed(4)}% = ${formatCurrency(payments.monthlyFinanceCharge)}`;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="tooltip-container flex flex-col items-center gap-0.5">
                        <div className="font-semibold cursor-help">{formatCurrency(payments.monthlyFinanceCharge)}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400 cursor-help">
                          ({formatCurrency(payments.adjustedCapCost)} + {formatCurrency(payments.residualValue)}) × {payments.currentApr.toFixed(2)}% ÷ 12
                        </div>
                        <div className="tooltip-text">{tooltipText}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Payment (without tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.baseMonthlyPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <td className="p-1.5 font-bold text-gray-900 dark:text-white sticky left-0 bg-blue-50 dark:bg-blue-900/20 z-10 text-xs">Monthly Payment (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center font-bold text-blue-600 dark:text-blue-400">{formatCurrency(payments.totalMonthlyPayment)}</td>
                  );
                })}
              </tr>

              {/* Total Lease Cost */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Total Lease Cost</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total (without tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const total = payments.baseMonthlyPayment * car.leaseTerm;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(total)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-green-50 dark:bg-green-900/20">
                <td className="p-1.5 font-bold text-gray-900 dark:text-white sticky left-0 bg-green-50 dark:bg-green-900/20 z-10 text-xs">Total (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const total = payments.totalMonthlyPayment * car.leaseTerm;
                  return (
                    <td key={car.id} className="p-3 text-center font-bold text-green-600 dark:text-green-400">{formatCurrency(total)}</td>
                  );
                })}
              </tr>

              {/* Additional Info */}
              {sortedCars.some(car => car.notes && car.notes.trim()) && (
                <>
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Notes</td>
                  </tr>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 text-xs">Notes</td>
                    {sortedCars.map((car) => (
                      <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs whitespace-pre-wrap max-w-xs">{car.notes || 'N/A'}</td>
                    ))}
                  </tr>
                </>
              )}

              {/* Most Important Info */}
              <tr className="bg-yellow-50 dark:bg-yellow-900/20">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Most Important Info</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">MSRP</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(car.msrp)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">CAP Amount</td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const discount = overrides?.discount !== undefined ? overrides.discount : (car.discount || 0);
                  const discountAmount = car.msrp * (discount / 100);
                  const hasOverride = carOverrides[car.id]?.discount !== undefined && carOverrides[car.id]?.discount !== '';
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-xs">
                          {formatCurrency(payments.baseCapCost)}
                          {discount > 0 && (
                            <span className="text-gray-600 dark:text-gray-400 ml-1 text-[10px]">
                              ({discount.toFixed(1)}%, {formatCurrency(discountAmount)})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            step="0.1"
                            placeholder="Discount %"
                            value={carOverrides[car.id]?.discount ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'discount', e.target.value)}
                            className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'discount')}
                              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              title="Clear override"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Residual Value</td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const residualPercent = overrides?.residualPercent !== undefined ? overrides.residualPercent : car.residualPercent;
                  const hasOverride = carOverrides[car.id]?.residualPercent !== undefined && carOverrides[car.id]?.residualPercent !== '';
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="flex flex-col items-center gap-1">
                        <div className="text-xs">
                          {formatCurrency(payments.residualValue)}
                          <span className="text-gray-600 dark:text-gray-400 ml-1 text-[10px]">({residualPercent.toFixed(1)}%)</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            placeholder="Residual %"
                            value={carOverrides[car.id]?.residualPercent ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'residualPercent', e.target.value)}
                            className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'residualPercent')}
                              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              title="Clear override"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Total Fees</td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const tagTitleFiling = car.tagTitleFilingFees || 0;
                  const handling = car.handlingFees || 0;
                  const other = car.otherFees || 0;
                  const tooltipText = `Tag/Title/Filing: ${formatCurrency(tagTitleFiling)}\nHandling: ${formatCurrency(handling)}\nOther: ${formatCurrency(other)}`;
                  const hasOverride = carOverrides[car.id]?.totalFees !== undefined && carOverrides[car.id]?.totalFees !== '';
                  return (
                    <td 
                      key={car.id} 
                      className="p-1.5 text-center text-gray-900 dark:text-white font-semibold cursor-help text-xs"
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div title={tooltipText}>{formatCurrency(payments.totalFees)}</div>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            step="100"
                            placeholder="Total $"
                            value={carOverrides[car.id]?.totalFees ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'totalFees', e.target.value)}
                            className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'totalFees')}
                              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              title="Clear override"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Down Payment</td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const hasOverride = carOverrides[car.id]?.downPayment !== undefined && carOverrides[car.id]?.downPayment !== '';
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <div className="text-xs">{formatCurrency(payments.totalDownPayment)}</div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="100"
                            placeholder="Down $"
                            value={carOverrides[car.id]?.downPayment ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'downPayment', e.target.value)}
                            className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'downPayment')}
                              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              title="Clear override"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Suggested Cap with Fees and Taxes</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.adjustedCapCostWithTax)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Payment for Depreciation<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">Depreciation ÷ Months</span></td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  const tooltipText = `Depreciation Calculation:\nTotal Depreciation: ${formatCurrency(payments.depreciation)}\n(Cap Amount: ${formatCurrency(payments.adjustedCapCost)} - Residual Value: ${formatCurrency(payments.residualValue)})\n\nMonthly Depreciation:\n${formatCurrency(payments.depreciation)} ÷ ${car.leaseTerm} months = ${formatCurrency(payments.monthlyDepreciation)}`;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="tooltip-container flex flex-col items-center gap-0.5 cursor-help">
                        <div className="font-semibold">{formatCurrency(payments.monthlyDepreciation)}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">
                          {formatCurrency(payments.depreciation)} ÷ {car.leaseTerm}
                        </div>
                        <div className="tooltip-text">{tooltipText}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Payment for Finance<br/><span className="text-[10px] text-gray-500 dark:text-gray-400">(Cap + Residual) × Rate</span></td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const apr = overrides?.apr !== undefined ? overrides.apr : (overrides?.marketFactor !== undefined ? overrides.marketFactor * 2400 : (car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0)));
                  const marketFactor = overrides?.marketFactor !== undefined ? overrides.marketFactor : (overrides?.apr !== undefined ? overrides.apr / 2400 : (car.marketFactor || (car.apr ? car.apr / 2400 : 0)));
                  const hasAprOverride = carOverrides[car.id]?.apr !== undefined && carOverrides[car.id]?.apr !== '';
                  const hasMfOverride = carOverrides[car.id]?.marketFactor !== undefined && carOverrides[car.id]?.marketFactor !== '';
                  const monthlyRate = apr / 100 / 12;
                  const tooltipText = `Finance Charge Calculation:\nCap Amount: ${formatCurrency(payments.adjustedCapCost)}\nResidual Value: ${formatCurrency(payments.residualValue)}\nAPR: ${apr.toFixed(2)}%\nMonthly Rate: ${apr.toFixed(2)}% ÷ 12 = ${(monthlyRate * 100).toFixed(4)}%\n\nMonthly Finance Charge:\n(${formatCurrency(payments.adjustedCapCost)} + ${formatCurrency(payments.residualValue)}) × ${(monthlyRate * 100).toFixed(4)}% = ${formatCurrency(payments.monthlyFinanceCharge)}`;
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="tooltip-container flex flex-col items-center gap-0.5">
                        <div className="font-semibold cursor-help">{formatCurrency(payments.monthlyFinanceCharge)}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400 cursor-help">
                          ({formatCurrency(payments.adjustedCapCost)} + {formatCurrency(payments.residualValue)}) × {apr.toFixed(2)}% ÷ 12
                        </div>
                        <div className="tooltip-text">{tooltipText}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">({apr.toFixed(2)}% APR, {marketFactor.toFixed(6)} MF)</div>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="APR %"
                            value={carOverrides[car.id]?.apr ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'apr', e.target.value)}
                            className="w-14 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          <span className="text-[10px] text-gray-500">or</span>
                          <input
                            type="number"
                            step="0.000001"
                            placeholder="MF"
                            value={carOverrides[car.id]?.marketFactor ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'marketFactor', e.target.value)}
                            className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {(hasAprOverride || hasMfOverride) && (
                            <button
                              onClick={() => {
                                clearCarOverride(car.id, 'apr');
                                clearCarOverride(car.id, 'marketFactor');
                              }}
                              className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              title="Clear override"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Total</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.baseMonthlyPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-bold text-gray-900 dark:text-white sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Payment Total with Taxes</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-3 text-center font-bold text-blue-600 dark:text-blue-400">{formatCurrency(payments.totalMonthlyPayment)}</td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Explanatory Legends */}
        {sortedCars.length > 0 && (() => {
          const cheapestCar = sortedCars[0];
          const cheapestPayments = getCarPaymentsWithOverride(cheapestCar, overrideDownPaymentValue, getCarOverrides(cheapestCar.id));
          return (
            <div className="mt-6 space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <h3 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-2">
                  Why Do Dealerships Make You Pay Depreciation?
                </h3>
                <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed mb-2">
                  Depreciation represents the value your vehicle loses over the lease term. When you lease a car, you're essentially paying for the difference between what the car is worth now (Cap Amount) and what it will be worth at the end of the lease (Residual Value). This is the portion of the vehicle's value you "use up" during your lease period. The dealership needs to recover this lost value because the car will be worth less when you return it, and they need to account for normal wear, mileage, and market depreciation.
                </p>
                <div className="text-xs text-blue-900 dark:text-blue-100 font-semibold mt-3 pt-3 border-t border-blue-200 dark:border-blue-700">
                  Example ({getCarDisplayName(cheapestCar)}):
      </div>
                <div className="text-xs text-blue-800 dark:text-blue-200 mt-1 space-y-1">
                  <div>• Cap Amount: {formatCurrency(cheapestPayments.adjustedCapCost)}</div>
                  <div>• Residual Value: {formatCurrency(cheapestPayments.residualValue)}</div>
                  <div>• Total Depreciation: {formatCurrency(cheapestPayments.adjustedCapCost)} - {formatCurrency(cheapestPayments.residualValue)} = <span className="font-semibold">{formatCurrency(cheapestPayments.depreciation)}</span></div>
                  <div>• Monthly Depreciation: {formatCurrency(cheapestPayments.depreciation)} ÷ {cheapestCar.leaseTerm} months = <span className="font-semibold">{formatCurrency(cheapestPayments.monthlyDepreciation)}/month</span></div>
    </div>
                <div className="text-xs text-blue-900 dark:text-blue-100 font-semibold mt-3 pt-3 border-t border-blue-200 dark:border-blue-700">
                  Key Insight:
                </div>
                <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed mt-1">
                  Notice how the residual value directly affects your monthly payment: <span className="font-semibold">the higher the residual value, the lower you pay per month</span> because you have less depreciation to pay. In the example above, if the residual value were higher (meaning the car retains more value), the depreciation amount ({formatCurrency(cheapestPayments.depreciation)}) would be smaller, resulting in a lower monthly depreciation payment. This is why vehicles with better resale value (higher residual percentages) typically have lower lease payments.
                </p>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <h3 className="text-sm font-bold text-purple-900 dark:text-purple-100 mb-2">
                  Why Do Dealerships Charge Finance Fees on the Residual Value?
                </h3>
                <p className="text-xs text-purple-800 dark:text-purple-200 leading-relaxed mb-2">
                  During a lease, the dealership (or leasing company) owns the vehicle and has their money tied up in both the portion you're using (depreciation) AND the residual value (what the car will be worth at lease end). Even though you're not buying the residual portion, the dealership still has capital invested in it. They charge finance fees on the total amount (Cap Amount + Residual Value) because they're financing the entire vehicle's value, not just the depreciation portion. This compensates them for the opportunity cost of having their money tied up in the vehicle's residual value throughout the lease term.
                </p>
                <div className="text-xs text-purple-900 dark:text-purple-100 font-semibold mt-3 pt-3 border-t border-purple-200 dark:border-purple-700">
                  Example ({getCarDisplayName(cheapestCar)}):
                </div>
                <div className="text-xs text-purple-800 dark:text-purple-200 mt-1 space-y-1">
                  <div>• Cap Amount: {formatCurrency(cheapestPayments.adjustedCapCost)}</div>
                  <div>• Residual Value: {formatCurrency(cheapestPayments.residualValue)}</div>
                  <div>• Total Financed: {formatCurrency(cheapestPayments.adjustedCapCost)} + {formatCurrency(cheapestPayments.residualValue)} = <span className="font-semibold">{formatCurrency(cheapestPayments.adjustedCapCost + cheapestPayments.residualValue)}</span></div>
                  <div>• APR: {cheapestPayments.currentApr.toFixed(2)}% (Monthly Rate: {(cheapestPayments.currentApr / 100 / 12 * 100).toFixed(4)}%)</div>
                  <div>• Monthly Finance Charge: {formatCurrency(cheapestPayments.adjustedCapCost + cheapestPayments.residualValue)} × {(cheapestPayments.currentApr / 100 / 12 * 100).toFixed(4)}% = <span className="font-semibold">{formatCurrency(cheapestPayments.monthlyFinanceCharge)}/month</span></div>
                </div>
              </div>

              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
                <h3 className="text-sm font-bold text-orange-900 dark:text-orange-100 mb-2">
                  ⚠️ Dealership Tactic: APR Markup to Create Illusion of Discount
                </h3>
                <p className="text-xs text-orange-800 dark:text-orange-200 leading-relaxed">
                  Dealerships often use a deceptive tactic where they offer a discount on the vehicle price but simultaneously mark up the APR (interest rate). This creates an illusion that you're getting a great deal, but in reality, you end up paying the same or more through higher finance charges. Always check both the discount percentage AND the APR rate. A lower price with a higher APR may cost you more over the lease term than a higher price with a lower APR. Compare the total monthly payment and total lease cost, not just the discount amount.
                </p>
              </div>

              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <h3 className="text-sm font-bold text-red-900 dark:text-red-100 mb-2">
                  💡 Down Payments Are Not Necessary on Leases
                </h3>
                <p className="text-xs text-red-800 dark:text-red-200 leading-relaxed">
                  Unlike purchasing a car, <span className="font-semibold">down payments on leases don't give you any actual rebate or equity</span>. They only reduce your monthly payment by spreading the same total cost differently. Since you don't own the car at the end of the lease, that down payment money is essentially gone - you're just pre-paying part of the lease. Consider keeping your down payment low or at $0, and instead invest that money elsewhere or keep it for emergencies. The only exception is if the dealership offers a specific incentive tied to a down payment, but even then, calculate whether the total cost is truly lower.
                </p>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
                <h3 className="text-sm font-bold text-yellow-900 dark:text-yellow-100 mb-2">
                  ⚠️ Dealership Tactic: Discounting Car but Marking Up Residual Value
                </h3>
                <p className="text-xs text-yellow-800 dark:text-yellow-200 leading-relaxed mb-2">
                  Some dealerships may offer a discount on the vehicle price but then inflate the residual value percentage above what's reasonable for that lease term. This tactic makes the monthly payment look lower (because depreciation = Cap - Residual), but you're still paying the same total amount - just structured differently. <span className="font-semibold">Always verify that the residual percentage matches industry standards for your lease term</span>. For example, for a 36-month lease, the residual should typically be between 58-60% (with 60% being the standard baseline). For shorter terms like 24 months, expect 64-66%, while longer terms like 48 months should be around 52-54%. Use the "Expected Residual %" row in the comparison table above to check if your residual is reasonable. If a dealership offers a discount but the residual seems too high, they may be recouping that discount elsewhere.
                </p>
                {sortedCars.length > 0 && (() => {
                  const firstCar = sortedCars[0];
                  const expectedResidual = getExpectedResidualPercent(firstCar.leaseTerm, firstCar.milesPerYear || 12000);
                  const minResidual = Math.max(0, expectedResidual - 2);
                  const maxResidual = Math.min(100, expectedResidual + 2);
                  return (
                    <>
                      <div className="text-xs text-yellow-900 dark:text-yellow-100 font-semibold mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-700">
                        Expected Residual Range for {firstCar.leaseTerm}-Month Lease:
                      </div>
                      <div className="text-xs text-yellow-800 dark:text-yellow-200 mt-1 space-y-1">
                        <div>• Expected Residual: <span className="font-semibold">{expectedResidual.toFixed(1)}%</span></div>
                        <div>• Acceptable Range: <span className="font-semibold">{minResidual.toFixed(1)}% - {maxResidual.toFixed(1)}%</span></div>
                        <div>• {getCarDisplayName(firstCar)} Actual: <span className={`font-semibold ${firstCar.residualPercent >= minResidual && firstCar.residualPercent <= maxResidual ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{firstCar.residualPercent.toFixed(1)}%</span></div>
                        <div className="text-[10px] text-yellow-700 dark:text-yellow-300 mt-2 italic">
                          Residual values within ±2% of expected are considered reasonable. Values significantly outside this range may indicate manipulation.
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="bg-pink-50 dark:bg-pink-900/20 rounded-lg p-4 border border-pink-200 dark:border-pink-800">
                <h3 className="text-sm font-bold text-pink-900 dark:text-pink-100 mb-2">
                  ⚠️ Dealership Tactic: Unnecessary Fees and Warranty Upsells
                </h3>
                <p className="text-xs text-pink-800 dark:text-pink-200 leading-relaxed mb-3">
                  Dealerships may try to add various fees or pressure you into unnecessary warranty packages, extended service plans, or protection packages. These can significantly increase your total lease cost. <span className="font-semibold">Be careful and question every fee</span>. As a general guideline, <span className="font-semibold">total fees (excluding sales tax) should typically be between $500-$1,200</span>. Anything significantly higher is likely markup. Here's how to handle different types of fees:
                </p>
                
                <div className="text-xs text-pink-900 dark:text-pink-100 font-semibold mt-3 pt-3 border-t border-pink-200 dark:border-pink-700 mb-2">
                  Fees to Negotiate Aggressively (Often Overpriced):
                </div>
                <div className="text-xs text-pink-800 dark:text-pink-200 space-y-1 mb-3">
                  <div>• <span className="font-semibold">Documentation Fee (Doc Fee)</span>: Often $200-$800, but actual cost is $50-$150. Negotiate this down or off completely.</div>
                  <div>• <span className="font-semibold">Dealer Prep Fee</span>: Usually $200-$500. This is often already included in the vehicle price - negotiate to remove it.</div>
                  <div>• <span className="font-semibold">Acquisition Fee</span>: Typically $500-$900. This is sometimes negotiable, especially if you're a repeat customer or have good credit.</div>
                  <div>• <span className="font-semibold">Advertising Fee</span>: Usually $100-$300. This is pure profit for the dealer - negotiate to remove it entirely.</div>
                </div>

                <div className="text-xs text-pink-900 dark:text-pink-100 font-semibold mt-3 pt-3 border-t border-pink-200 dark:border-pink-700 mb-2">
                  Fees to Negotiate Off Completely (Unnecessary):
                </div>
                <div className="text-xs text-pink-800 dark:text-pink-200 space-y-1 mb-3">
                  <div>• <span className="font-semibold">VIN Etching</span>: $200-$400. This is pure profit - refuse it completely.</div>
                  <div>• <span className="font-semibold">Paint/Fabric Protection</span>: $300-$800. These treatments are often ineffective and overpriced - decline.</div>
                  <div>• <span className="font-semibold">Tire/Wheel Protection</span>: $400-$1,200. Usually unnecessary and expensive - skip it.</div>
                  <div>• <span className="font-semibold">Gap Insurance</span>: Often $400-$800. Check if your insurance already covers this, or if it's included in the lease.</div>
                  <div>• <span className="font-semibold">Credit Life/Disability Insurance</span>: $300-$600. Rarely needed - decline.</div>
                </div>

                <div className="text-xs text-pink-900 dark:text-pink-100 font-semibold mt-3 pt-3 border-t border-pink-200 dark:border-pink-700 mb-2">
                  Fees to Totally Avoid (Scams):
                </div>
                <div className="text-xs text-pink-800 dark:text-pink-200 space-y-1 mb-3">
                  <div>• <span className="font-semibold">Extended Warranty</span>: $1,500-$4,000. <span className="font-bold text-red-700 dark:text-red-300">NEVER buy extended warranty on a lease</span> - the vehicle is under manufacturer warranty for the lease term, and you don't own it at the end.</div>
                  <div>• <span className="font-semibold">Extended Service Plans</span>: $800-$2,500. Same as extended warranty - unnecessary on leases.</div>
                  <div>• <span className="font-semibold">Maintenance Packages</span>: $500-$1,500. You can maintain the car yourself or at any shop - don't prepay.</div>
                  <div>• <span className="font-semibold">Theft Protection/Window Etching</span>: $200-$500. Pure markup - refuse completely.</div>
                </div>

                <div className="text-xs text-pink-900 dark:text-pink-100 font-semibold mt-3 pt-3 border-t border-pink-200 dark:border-pink-700 mb-2">
                  Legitimate Fees (Usually Non-Negotiable):
                </div>
                <div className="text-xs text-pink-800 dark:text-pink-200 space-y-1">
                  <div>• <span className="font-semibold">Tag/Title/Filing Fees</span>: $50-$400 (varies by state). These are government fees and usually non-negotiable.</div>
                  <div>• <span className="font-semibold">Sales Tax</span>: Based on your state/local rate. Non-negotiable, but make sure they're calculating it correctly.</div>
                  <div>• <span className="font-semibold">Registration Fees</span>: $50-$200 (varies by state). Government fees, non-negotiable.</div>
                </div>

                <p className="text-xs text-pink-800 dark:text-pink-200 leading-relaxed mt-3 pt-3 border-t border-pink-200 dark:border-pink-700">
                  <span className="font-semibold">Remember:</span> Always ask what each fee is for. If a dealer insists on a fee, ask them to reduce the vehicle price by that amount instead. If they won't negotiate fees, walk away - there are other dealers who will.
                </p>
              </div>
            </div>
          );
        })()}

        {/* AI Analysis Section */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Analysis</h3>
            <button
              onClick={handleAnalyzeComparison}
              disabled={isAnalyzing || sortedCars.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Comparison'}
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Custom Analysis Request (Optional):
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="E.g., Focus on residual values and negotiation opportunities..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              rows={2}
            />
          </div>

          {analysisError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-200">{analysisError}</p>
            </div>
          )}

          {analysis && (
            <div className="mb-4">
              <div className="prose prose-sm dark:prose-invert max-w-none bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
                <div 
                  className="text-sm text-gray-800 dark:text-gray-200 markdown-content"
                  dangerouslySetInnerHTML={{ 
                    __html: (() => {
                      let html = analysis;
                      
                      // Convert markdown tables - handle multi-line tables
                      const tableRegex = /(\|.+\|(?:\n\|[:\s-]+\|)?(?:\n\|.+\|)+)/g;
                      html = html.replace(tableRegex, (tableMatch) => {
                        const lines = tableMatch.trim().split('\n');
                        const rows: string[] = [];
                        
                        lines.forEach((line, index) => {
                          // Skip separator row (contains --- or :---)
                          if (line.includes('---') || line.includes(':')) {
                            return;
                          }
                          
                          const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
                          if (cells.length > 0) {
                            const isHeader = index === 0;
                            const tag = isHeader ? 'th' : 'td';
                            const cellClass = isHeader 
                              ? 'px-3 py-2 font-semibold bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-left'
                              : 'px-3 py-2 border border-gray-300 dark:border-gray-600';
                            rows.push(`<tr>${cells.map(cell => `<${tag} class="${cellClass}">${cell}</${tag}>`).join('')}</tr>`);
                          }
                        });
                        
                        if (rows.length > 0) {
                          const headerRow = rows[0];
                          const bodyRows = rows.slice(1).join('');
                          return `<div class="overflow-x-auto my-4"><table class="min-w-full border-collapse border border-gray-300 dark:border-gray-600"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
                        }
                        return tableMatch;
                      });
                      
                      // Convert headers
                      html = html.replace(/## (.*?)(<br \/>|$|\n)/g, '<h2 class="text-base font-bold mt-4 mb-2 text-gray-900 dark:text-white">$1</h2>');
                      html = html.replace(/### (.*?)(<br \/>|$|\n)/g, '<h3 class="text-sm font-bold mt-3 mb-1 text-gray-900 dark:text-white">$1</h3>');
                      
                      // Convert bold
                      html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>');
                      
                      // Convert bullet points
                      html = html.replace(/^- (.*?)(<br \/>|$|\n)/gm, '<li class="ml-4 list-disc">$1</li>');
                      
                      // Convert line breaks (but preserve table structure)
                      html = html.replace(/\n/g, '<br />');
                      
                      return html;
                    })()
                  }} 
                />
              </div>

              <div className="mt-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={followUpPrompt}
                    onChange={(e) => setFollowUpPrompt(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && !isFollowUpAnalyzing && handleFollowUpQuestion()}
                    placeholder="Ask a follow-up question..."
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={handleFollowUpQuestion}
                    disabled={isFollowUpAnalyzing || !followUpPrompt.trim()}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isFollowUpAnalyzing ? 'Asking...' : 'Ask'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

