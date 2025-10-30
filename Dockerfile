# Use the official Node.js 22 LTS image
FROM node:22-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# The server will read the port from the .env file, but we expose 3001 as a default
EXPOSE 3001

# The command to run the application
CMD [ "node", "server.js" ]
