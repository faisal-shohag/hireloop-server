const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("hireloop2");
    // const JWKS_db = (await db.collection("jwks").find().toArray())[0];
    // const verifyToken = async (req, res, next) => {
    //   const authHeader = req?.headers.authorization;
    //   if (!authHeader) {
    //     return res.status(401).json({ message: "Unauthorized" });
    //   }
    //   const token = authHeader.split(" ")[1];
    //   if (!token) {
    //     return res.status(401).json({ message: "Unauthorized" });
    //   }

    //   try {
    //     const { payload } = await jwtVerify(token, JWKS_db);
    //     console.log(payload);
    //     next();
    //   } catch (error) {
    //     return res.status(403).json({ message: "Forbidden" });
    //   }
    // };
    const companyCollection = db.collection("companies");
    const jobCollection = db.collection("jobs")



    // Recruiter apis
    app.post("/company", async (req, res) => {
      const company = req.body;
      const result = await companyCollection.insertOne(company);
      res.json(result);
    });

    app.get("/company/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await companyCollection
        .find({
          userEmail,
        })
        .toArray();
      res.json(result);
    });

    app.get("/approved-companies/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await companyCollection
        .find({ status: "approved", userEmail })
        .toArray();
      res.json(result);
    });

    //post a job
    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne({
        ...job,
        company: new ObjectId(job.company)
      });
      res.json(result);
    });

    //get jobs by user Id
    app.get("/my-jobs/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await jobCollection.find({userEmail}).toArray()
      res.json(result);
    })


    //get a particular job with company look up
    app.get("/jobs/:jobId", async (req, res) => {
      const { jobId } = req.params;
      const result = await jobCollection.aggregate([
        {$match: {_id: new ObjectId(jobId)}},
        {$lookup: {
            from: "companies",
            localField: "company",
            foreignField: "_id",
            as: "companyInfo"
        }}
      ]).toArray();
      res.json(result);
    });


    //get jobs by specific company 
    
    app.get("/jobs/company/:companyId", async (req, res) => {
      const { companyId } = req.params;
      const result = await jobCollection
        .find({
          company: new ObjectId(companyId),
        })
        .toArray();
      res.json(result);
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
