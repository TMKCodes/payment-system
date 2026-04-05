import type { NextConfig } from "next";
import webpack from 'webpack';

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve('buffer'),
    };
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    );
    return config;
  },
  turbopack: {},
  serverExternalPackages: ['hoosat-sdk'],
};

export default nextConfig;
