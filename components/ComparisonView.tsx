'use client';

import { useState, useEffect } from 'react';
import {
  LeaseData,
  SavedCars,
  getCarDisplayName,
  getCarPayments,
  loadFromStorage,
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
    };
  }>({});

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

  if (savedCars.cars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">No cars to compare. Add at least one car to use the comparison view.</p>
      </div>
    );
  }

  const formatCurrency = (amount: number) => 
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Helper function to get payments with optional overrides
  const getCarPaymentsWithOverride = (
    car: LeaseData, 
    overrideDownPaymentValue?: number,
    overrides?: { discount?: number; residualPercent?: number; apr?: number; marketFactor?: number; downPayment?: number }
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
    const totalFees = 
      (car.tagTitleFilingFees || 0) +
      (car.handlingFees || 0) +
      (car.otherFees || 0);
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
    };
  };

  // Helper to update car override
  const updateCarOverride = (carId: string, field: 'discount' | 'residualPercent' | 'apr' | 'marketFactor' | 'downPayment', value: string) => {
    setCarOverrides(prev => ({
      ...prev,
      [carId]: {
        ...prev[carId],
        [field]: value,
      },
    }));
  };

  // Helper to clear car override
  const clearCarOverride = (carId: string, field: 'discount' | 'residualPercent' | 'apr' | 'marketFactor' | 'downPayment') => {
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
  const sortedCars = [...selectedCars].sort((a, b) => {
    const paymentsA = getCarPaymentsWithOverride(a, overrideDownPaymentValue, getCarOverrides(a.id));
    const paymentsB = getCarPaymentsWithOverride(b, overrideDownPaymentValue, getCarOverrides(b.id));
    return paymentsA.totalMonthlyPayment - paymentsB.totalMonthlyPayment;
  });

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
        <div className="flex flex-wrap gap-1">
          {savedCars.cars.map((car) => {
            const isSelected = selectedCarIds.has(car.id);
            const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
            return (
              <label
                key={car.id}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400'
                }`}
              >
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
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="border-b-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
                <th className="text-left p-1.5 font-semibold text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-30 border-r border-gray-200 dark:border-gray-700 text-xs">Car</th>
                {sortedCars.map((car) => (
                  <th key={car.id} className="text-center p-1.5 font-semibold text-gray-900 dark:text-white min-w-[120px] bg-white dark:bg-gray-800">
                    <div className="font-bold text-xs">{getCarDisplayName(car)}</div>
                    {car.dealership && <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">{car.dealership}</div>}
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
              {sortedCars.some(car => car.vin) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">VIN</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-mono text-xs">{car.vin || 'N/A'}</td>
                  ))}
                </tr>
              )}
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
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Residual %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{car.residualPercent.toFixed(1)}%</td>
                ))}
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
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Depreciation (Total)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.depreciation)}</td>
                  );
                })}
              </tr>

              {/* Monthly Payments */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-1 font-bold text-gray-900 dark:text-white text-xs">Monthly Payments</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Depreciation</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.monthlyDepreciation)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Finance Charge</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.monthlyFinanceCharge)}</td>
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
                    <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Notes</td>
                    {sortedCars.map((car) => (
                      <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white text-sm whitespace-pre-wrap max-w-xs">{car.notes || 'N/A'}</td>
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
                      <div className="flex flex-col items-center gap-1">
                        <div>
                          {formatCurrency(payments.baseCapCost)}
                          {discount > 0 && (
                            <span className="text-gray-600 dark:text-gray-400 ml-2">
                              ({discount.toFixed(1)}%, {formatCurrency(discountAmount)})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            placeholder="Discount %"
                            value={carOverrides[car.id]?.discount ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'discount', e.target.value)}
                            className="w-20 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'discount')}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline"
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
                        <div>
                          {formatCurrency(payments.residualValue)}
                          <span className="text-gray-600 dark:text-gray-400 ml-2">({residualPercent.toFixed(1)}%)</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            placeholder="Residual %"
                            value={carOverrides[car.id]?.residualPercent ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'residualPercent', e.target.value)}
                            className="w-20 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'residualPercent')}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline"
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
                  return (
                    <td 
                      key={car.id} 
                      className="p-3 text-center text-gray-900 dark:text-white font-semibold cursor-help" 
                      title={tooltipText}
                    >
                      {formatCurrency(payments.totalFees)}
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
                        <div>{formatCurrency(payments.totalDownPayment)}</div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="100"
                            placeholder="Down $"
                            value={carOverrides[car.id]?.downPayment ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'downPayment', e.target.value)}
                            className="w-20 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {hasOverride && (
                            <button
                              onClick={() => clearCarOverride(car.id, 'downPayment')}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline"
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
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Payment for Depreciation</td>
                {sortedCars.map((car) => {
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, getCarOverrides(car.id));
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">{formatCurrency(payments.monthlyDepreciation)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
                <td className="p-1.5 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700 text-xs">Monthly Payment for Finance</td>
                {sortedCars.map((car) => {
                  const overrides = getCarOverrides(car.id);
                  const payments = getCarPaymentsWithOverride(car, overrideDownPaymentValue, overrides);
                  const apr = overrides?.apr !== undefined ? overrides.apr : (overrides?.marketFactor !== undefined ? overrides.marketFactor * 2400 : (car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0)));
                  const marketFactor = overrides?.marketFactor !== undefined ? overrides.marketFactor : (overrides?.apr !== undefined ? overrides.apr / 2400 : (car.marketFactor || (car.apr ? car.apr / 2400 : 0)));
                  const hasAprOverride = carOverrides[car.id]?.apr !== undefined && carOverrides[car.id]?.apr !== '';
                  const hasMfOverride = carOverrides[car.id]?.marketFactor !== undefined && carOverrides[car.id]?.marketFactor !== '';
                  return (
                    <td key={car.id} className="p-1.5 text-center text-gray-900 dark:text-white text-xs">
                      <div className="flex flex-col items-center gap-1">
                        <div>{formatCurrency(payments.monthlyFinanceCharge)}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">({apr.toFixed(2)}% APR, {marketFactor.toFixed(6)} MF)</div>
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="APR %"
                            value={carOverrides[car.id]?.apr ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'apr', e.target.value)}
                            className="w-16 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          <span className="text-xs text-gray-500">or</span>
                          <input
                            type="number"
                            step="0.000001"
                            placeholder="MF"
                            value={carOverrides[car.id]?.marketFactor ?? ''}
                            onChange={(e) => updateCarOverride(car.id, 'marketFactor', e.target.value)}
                            className="w-20 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                          {(hasAprOverride || hasMfOverride) && (
                            <button
                              onClick={() => {
                                clearCarOverride(car.id, 'apr');
                                clearCarOverride(car.id, 'marketFactor');
                              }}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline"
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
                <td className="p-3 font-bold text-gray-900 dark:text-white sticky left-0 bg-yellow-50 dark:bg-yellow-900/20 z-10 border-r border-gray-200 dark:border-gray-700">Monthly Payment Total with Taxes</td>
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
      </div>
    </div>
  );
}

